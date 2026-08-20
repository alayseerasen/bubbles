/* ============================================================
   BUBBLES — E2E ENCRYPTION (js/crypto.js)
   ------------------------------------------------------------
   Схема (упрощённая, статические ключи — НЕ Signal-протокол,
   без forward secrecy, но сервер никогда не видит ни приватный
   ключ в открытом виде, ни текст сообщений):

   1. У аккаунта одна пара ключей ECDH (кривая P-256), общая на
      все устройства. Публичный ключ лежит в profiles.public_key
      открытым текстом (он и должен быть публичным).

   2. Приватный ключ ТОЖЕ хранится в Supabase (иначе не
      синхронизировать между устройствами), но только в виде,
      зашифрованном отдельной фразой-паролем шифрования:
      ключ шифрования = PBKDF2(фраза-пароль, соль, много итераций),
      приватный ключ шифруется AES-256-GCM этим ключом.
      Supabase видит только этот шифроблоб — без фразы-пароля
      он бесполезен.

   3. На каждом устройстве при первом входе на аккаунт нужно
      один раз ввести фразу-пароль шифрования (при регистрации —
      придумать её). После этого расшифрованный (не экспортируемый
      из WebCrypto) приватный ключ кэшируется в IndexedDB этого
      устройства, и повторно фразу-пароль вводить не нужно.

   4. Чтобы получить общий ключ переписки A<->B, обе стороны
      считают ECDH(A_priv, B_pub) == ECDH(B_priv, A_pub) — это
      одно и то же значение. Оно прогоняется через HKDF-SHA256,
      чтобы получить ключ AES-256-GCM для конкретной переписки.

   5. Текст и картинка сообщения шифруются AES-256-GCM со
      случайным IV на каждое сообщение.

   ВАЖНО: безопасность переписки настолько же надёжна, насколько
   надёжна и НИГДЕ БОЛЬШЕ не используется фраза-пароль шифрования.
   Если её забыть и не быть залогиненным ни на одном устройстве —
   расшифровать историю будет невозможно (сервер её тоже не знает).
   ============================================================ */

const BubblesCrypto = (() => {
    const DB_NAME = "bubbles-keys";
    const STORE_NAME = "keys";
    const HKDF_INFO = new TextEncoder().encode("bubbles-e2e-v1");
    const PBKDF2_ITERATIONS = 350000;

    let dbPromise = null;
    let myPrivateKey = null; // non-extractable CryptoKey, cached in memory after unlock
    let myUserId = null;
    const sharedKeyCache = new Map(); // partnerId -> Promise<CryptoKey>

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore(STORE_NAME);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    async function idbGet(key) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbSet(key, value) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function idbDelete(key) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    function bufToBase64(buf) {
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    function base64ToBuf(b64) {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }

    function localKeyName(userId) {
        return `privateKey:${userId}`;
    }

    // Derives an AES-GCM "wrapping" key from the user's encryption
    // passphrase + a per-account random salt. This key only ever exists
    // transiently in memory — it's used to lock/unlock the private key
    // and is never stored anywhere.
    async function deriveWrappingKey(passphrase, saltB64, iterations) {
        const baseKey = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(passphrase),
            "PBKDF2",
            false,
            ["deriveKey"]
        );
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: base64ToBuf(saltB64), iterations: iterations || PBKDF2_ITERATIONS, hash: "SHA-256" },
            baseKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    // True once this device already has a usable (non-extractable) private
    // key for `userId` cached locally — no passphrase prompt needed.
    async function hasLocalKeyForUser(userId) {
        const key = await idbGet(localKeyName(userId));
        if (!key) return false;
        myPrivateKey = key;
        myUserId = userId;
        return true;
    }

    async function importNonExtractablePrivateKey(pkcs8Buf) {
        return crypto.subtle.importKey(
            "pkcs8",
            pkcs8Buf,
            { name: "ECDH", namedCurve: "P-256" },
            false,
            ["deriveKey", "deriveBits"]
        );
    }

    // First-ever setup for this account (no key exists anywhere yet):
    // generates the keypair, wraps the private key with `passphrase`, and
    // uploads public_key + the encrypted private key blob to profiles.
    async function createAccountKey(userId, passphrase) {
        const pair = await crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true, // extractable — needed once, to wrap+upload and to lock locally below
            ["deriveKey", "deriveBits"]
        );
        const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
        const publicKeyB64 = bufToBase64(spki);
        const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);

        const salt = crypto.getRandomValues(new Uint8Array(16));
        const wrapIv = crypto.getRandomValues(new Uint8Array(12));
        const wrappingKey = await deriveWrappingKey(passphrase, bufToBase64(salt), PBKDF2_ITERATIONS);
        const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv }, wrappingKey, pkcs8);

        const { error: profileError } = await sb.from("profiles").update({ public_key: publicKeyB64 }).eq("id", userId);
        if (profileError) throw profileError;
        const { error: keyError } = await sb.from("profile_keys").upsert({
            id: userId,
            encrypted_private_key: bufToBase64(wrapped),
            key_salt: bufToBase64(salt),
            key_wrap_iv: bufToBase64(wrapIv),
            key_kdf_iterations: PBKDF2_ITERATIONS,
            updated_at: new Date().toISOString()
        });
        if (keyError) throw keyError;

        const lockedPrivateKey = await importNonExtractablePrivateKey(pkcs8);
        await idbSet(localKeyName(userId), lockedPrivateKey);
        myPrivateKey = lockedPrivateKey;
        myUserId = userId;
        return publicKeyB64;
    }

    // New device / new browser for an account that already has E2E set up
    // elsewhere: unwraps the private key from Supabase using `passphrase`.
    // `keyRow` is a row from profile_keys (the caller fetches it — RLS only
    // lets a user read their own row there). Returns false (does NOT
    // throw) on a wrong passphrase, so the caller can let the person retry.
    async function unlockAccountKey(userId, passphrase, keyRow) {
        if (!keyRow?.encrypted_private_key) return false;
        try {
            const wrappingKey = await deriveWrappingKey(passphrase, keyRow.key_salt, keyRow.key_kdf_iterations);
            const pkcs8 = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: base64ToBuf(keyRow.key_wrap_iv) },
                wrappingKey,
                base64ToBuf(keyRow.encrypted_private_key)
            );
            const lockedPrivateKey = await importNonExtractablePrivateKey(pkcs8);
            await idbSet(localKeyName(userId), lockedPrivateKey);
            myPrivateKey = lockedPrivateKey;
            myUserId = userId;
            return true;
        } catch (e) {
            // AES-GCM auth tag mismatch (wrong passphrase) throws here.
            return false;
        }
    }

    // "Забыл фразу-пароль" escape hatch: generates a BRAND NEW keypair
    // wrapped with a new passphrase. All messages encrypted under the old
    // key (on every device, sent by anyone) become permanently unreadable —
    // this is unavoidable without the old passphrase.
    async function resetAccountKey(userId, newPassphrase) {
        await idbDelete(localKeyName(userId));
        sharedKeyCache.clear();
        rememberedPeerKey.clear();
        return createAccountKey(userId, newPassphrase);
    }

    async function importPeerPublicKey(publicKeyB64) {
        return crypto.subtle.importKey(
            "spki",
            base64ToBuf(publicKeyB64),
            { name: "ECDH", namedCurve: "P-256" },
            false,
            []
        );
    }

    async function deriveSharedKey(peerPublicKeyB64) {
        if (!myPrivateKey) throw new Error("Ключ шифрования этого аккаунта ещё не разблокирован");
        const peerKey = await importPeerPublicKey(peerPublicKeyB64);
        const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: peerKey }, myPrivateKey, 256);
        const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
        return crypto.subtle.deriveKey(
            { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: HKDF_INFO },
            hkdfKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    // Cached per conversation partner so we don't redo ECDH+HKDF on every message.
    // Keyed only by partnerId, which means if the partner's public key changes
    // mid-session (they just set up encryption, or reset their passphrase on
    // another device) this cache would silently keep deriving the OLD shared
    // secret. rememberedPeerKey lets callers detect that mismatch and
    // invalidateSharedKeyFor() lets them force a recompute against a fresh key.
    const rememberedPeerKey = new Map(); // partnerId -> publicKeyB64 last used to derive the cached key

    function getSharedKeyFor(partnerId, partnerPublicKeyB64) {
        if (!partnerPublicKeyB64 || !myPrivateKey) return null;
        if (rememberedPeerKey.get(partnerId) !== partnerPublicKeyB64) {
            sharedKeyCache.set(partnerId, deriveSharedKey(partnerPublicKeyB64));
            rememberedPeerKey.set(partnerId, partnerPublicKeyB64);
        }
        return sharedKeyCache.get(partnerId);
    }

    function invalidateSharedKeyFor(partnerId) {
        sharedKeyCache.delete(partnerId);
        rememberedPeerKey.delete(partnerId);
    }

    async function encryptString(sharedKey, plaintext) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            sharedKey,
            new TextEncoder().encode(plaintext)
        );
        return { ciphertext: bufToBase64(ciphertext), iv: bufToBase64(iv) };
    }

    async function decryptString(sharedKey, ciphertextB64, ivB64) {
        try {
            const plainBuf = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: base64ToBuf(ivB64) },
                sharedKey,
                base64ToBuf(ciphertextB64)
            );
            return new TextDecoder().decode(plainBuf);
        } catch (e) {
            console.error("Не удалось расшифровать сообщение:", e);
            return null;
        }
    }

    async function fetchOwnKeyRow(userId) {
        const { data, error } = await sb.from("profile_keys").select("*").eq("id", userId).maybeSingle();
        if (error) throw error;
        return data;
    }

    return {
        hasLocalKeyForUser,
        fetchOwnKeyRow,
        createAccountKey,
        unlockAccountKey,
        resetAccountKey,
        getSharedKeyFor,
        invalidateSharedKeyFor,
        encryptString,
        decryptString,
        isReady: () => !!myPrivateKey
    };
})();
