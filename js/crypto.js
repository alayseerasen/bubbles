/* ============================================================
   BUBBLES — MESSAGE ENCRYPTION (js/crypto.js)
   ------------------------------------------------------------
   Схема (как в большинстве соцсетей — шифрование при хранении и
   передаче, но без завязки на секрет, который может отсутствовать
   на конкретном устройстве):

   1. У каждой пары собеседников один случайный ключ AES-256-GCM
      ("ключ переписки"), который создаётся при первом сообщении
      между ними и лежит в таблице conversation_keys.

   2. RLS отдаёт строку conversation_keys только двум участникам
      этой переписки — никому больше. Любое ИХ устройство, где
      выполнен вход, может прочитать этот ключ в любой момент:
      не нужно ни помнить отдельную фразу-пароль, ни синхронизировать
      что-либо между устройствами вручную.

   3. Текст и картинка сообщения шифруются AES-256-GCM со случайным
      IV на каждое сообщение, используя ключ переписки.

   ВАЖНО: это НЕ end-to-end шифрование в строгом смысле — сервер
   технически может прочитать ключ переписки (у него есть доступ к
   базе), а значит и сообщения. Это осознанный компромисс: старая
   схема (ECDH + фраза-пароль, запертая в IndexedDB устройства)
   давала настоящий E2E, но если фраза-пароль терялась или
   сбрасывалась на одном устройстве, переписка переставала
   расшифровываться на всех остальных, иногда навсегда. Эта схема
   так не ломается — шифрование остаётся, но никогда не блокирует
   доставку или чтение сообщений.
   ============================================================ */

const BubblesCrypto = (() => {
    // partnerId -> Promise<CryptoKey>, cached for the session so we don't
    // hit the DB on every single message.
    const conversationKeyCache = new Map();

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

    // conversation_keys rows are keyed (user1, user2) with user1 < user2 so
    // both participants always land on the same row regardless of who
    // initiates the lookup/creation.
    function orderedPair(myId, partnerId) {
        return myId < partnerId ? [myId, partnerId] : [partnerId, myId];
    }

    async function importKeyFromBase64(b64) {
        return crypto.subtle.importKey("raw", base64ToBuf(b64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    }

    async function generateKeyBase64() {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        const raw = await crypto.subtle.exportKey("raw", key);
        return bufToBase64(raw);
    }

    // Fetches the shared key for this conversation, creating it on first
    // contact between the two people. If both sides race to create it at
    // once, the unique (user1,user2) primary key rejects the loser's insert
    // and we simply re-fetch the row the winner created — either way both
    // devices converge on the same key without any user action.
    async function fetchOrCreateConversationKeyB64(myId, partnerId) {
        const [user1, user2] = orderedPair(myId, partnerId);

        const { data, error } = await sb
            .from("conversation_keys")
            .select("encryption_key")
            .eq("user1", user1)
            .eq("user2", user2)
            .maybeSingle();
        if (error) throw error;
        if (data?.encryption_key) return data.encryption_key;

        const newKeyB64 = await generateKeyBase64();
        const { error: insertError } = await sb
            .from("conversation_keys")
            .insert({ user1, user2, encryption_key: newKeyB64 });

        if (!insertError) return newKeyB64;

        // Someone else's device (the partner, most likely) created the row
        // first — that's expected under a race, not a failure. Use theirs.
        const { data: existing, error: refetchError } = await sb
            .from("conversation_keys")
            .select("encryption_key")
            .eq("user1", user1)
            .eq("user2", user2)
            .maybeSingle();
        if (refetchError) throw refetchError;
        if (existing?.encryption_key) return existing.encryption_key;

        throw insertError;
    }

    function getConversationKey(myId, partnerId) {
        if (!conversationKeyCache.has(partnerId)) {
            conversationKeyCache.set(
                partnerId,
                fetchOrCreateConversationKeyB64(myId, partnerId)
                    .then(importKeyFromBase64)
                    .catch(err => {
                        // Don't leave a rejected promise cached — let the next
                        // attempt (e.g. the next message) try again instead of
                        // permanently failing for the rest of the session.
                        conversationKeyCache.delete(partnerId);
                        throw err;
                    })
            );
        }
        return conversationKeyCache.get(partnerId);
    }

    function invalidateConversationKey(partnerId) {
        conversationKeyCache.delete(partnerId);
    }

    async function encryptString(key, plaintext) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            new TextEncoder().encode(plaintext)
        );
        return { ciphertext: bufToBase64(ciphertext), iv: bufToBase64(iv) };
    }

    async function decryptString(key, ciphertextB64, ivB64) {
        try {
            const plainBuf = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: base64ToBuf(ivB64) },
                key,
                base64ToBuf(ciphertextB64)
            );
            return new TextDecoder().decode(plainBuf);
        } catch (e) {
            console.error("Не удалось расшифровать сообщение:", e);
            return null;
        }
    }

    return {
        getConversationKey,
        invalidateConversationKey,
        encryptString,
        decryptString,
        // No per-device unlock step anymore — encryption is always usable
        // the moment you're logged in. Kept as a function (not a constant)
        // since app.js calls it like one.
        isReady: () => true
    };
})();
