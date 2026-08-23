/* ============================================================
   BUBBLES — ЗВОНКИ (голосовые каналы, видео, демонстрация экрана)
   ------------------------------------------------------------
   Работает как в TeamSpeak: список постоянных каналов, заходишь —
   тебя слышат все, кто внутри. Видео и показ экрана — по желанию,
   отдельными кнопками.

   Технически — P2P WebRTC (mesh: у каждого участника прямое
   соединение с каждым, без отдельного медиа-сервера). Отлично
   работает для небольших групп (комфортно людей до 5-6 в одном
   канале одновременно, дальше нагрузка на исходящий канал каждого
   участника растёт линейно — это ограничение подхода "без сервера").

   Сигналинг (обмен offer/answer/ICE) идёт через Supabase Realtime
   Broadcast + Presence по каналу "call:<id>" — ничего не пишется
   в базу, всё эфемерно, как уже сделано для typing-индикатора.
   ============================================================ */

const CALL_QUALITY_PRESETS = {
    sd:  { label: "SD (480p)",  width: 640,  height: 480,  frameRate: 24, videoBitrate: 700_000,   screenBitrate: 1_500_000 },
    hd:  { label: "HD (720p)",  width: 1280, height: 720,  frameRate: 30, videoBitrate: 2_000_000, screenBitrate: 3_000_000 },
    fhd: { label: "Full HD (1080p)", width: 1920, height: 1080, frameRate: 30, videoBitrate: 3_500_000, screenBitrate: 5_000_000 }
};

const CALL_AUDIO_BITRATE = 128_000; // opus, кбит/с — заметно лучше дефолтных ~32кбит/с

function loadCallSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem("bubbles-call-settings") || "{}");
        return {
            micId: saved.micId || "",
            camId: saved.camId || "",
            speakerId: saved.speakerId || "",
            quality: saved.quality || "hd",
            noiseSuppression: saved.noiseSuppression !== false,
            echoCancellation: saved.echoCancellation !== false,
            autoGainControl: saved.autoGainControl !== false
        };
    } catch (e) {
        return { micId: "", camId: "", speakerId: "", quality: "hd", noiseSuppression: true, echoCancellation: true, autoGainControl: true };
    }
}

function saveCallSettings() {
    localStorage.setItem("bubbles-call-settings", JSON.stringify(callSettings));
}

let callSettings = loadCallSettings();

// Всё состояние текущего звонка живёт здесь. channelId === null значит
// "не в звонке". Пока не зашли ни в один канал — localStream тоже null.
let callState = {
    channelId: null,
    channelName: "",
    presenceChannel: null,   // канал Supabase Realtime для этого звонка
    localStream: null,       // микрофон (+ камера, если включена)
    screenStream: null,      // отдельный поток показа экрана
    peers: new Map(),        // userId -> { pc, polite, makingOffer, ignoreOffer, videoEl, screenEl }
    members: new Map(),      // userId -> presence-мета { name, avatar, video, screen, muted }
    micOn: true,
    camOn: false,
    screenOn: false
};

let callChannelsList = [];       // список каналов из БД
let callLobbySubs = new Map();   // channelId -> {channel, count, sample:[]} — для превью участников на странице "Звонки", без входа в звонок

/* ------------------------------------------------------------
   ЗАГРУЗКА СПИСКА КАНАЛОВ
   ------------------------------------------------------------ */

async function loadCallChannels() {
    const { data, error } = await sb.from("call_channels").select("*").order("created_at", { ascending: true });
    if (error) { console.error(error); return; }
    callChannelsList = data || [];
}

/* ------------------------------------------------------------
   СТРАНИЦА "ЗВОНКИ"
   ------------------------------------------------------------ */

async function renderCallsPage() {
    const page = document.getElementById("page");
    page.innerHTML = `<h1 class="section-title">📞 Звонки</h1><div class="card"><p class="muted">Загрузка каналов…</p></div>`;

    await loadCallChannels();
    teardownAllLobbySubs();

    page.innerHTML = `
        <h1 class="section-title">📞 Звонки</h1>

        <div class="card">
            <h3>Новый канал</h3>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <input id="newCallChannelName" placeholder="Название канала" maxlength="40" style="flex:1;min-width:160px;">
                <button onclick="createCallChannel()">➕ Создать</button>
            </div>
        </div>

        <div id="callChannelsList"></div>
    `;

    renderCallChannelsList();

    // Подписываемся на presence каждого канала только чтобы показать,
    // кто там сейчас — сами при этом никуда не "заходим" (track() не
    // вызываем), поэтому в списках у других это не отображается как визит.
    callChannelsList.forEach(ch => {
        if (ch.id === callState.channelId) return; // уже подключены по-настоящему
        const lobby = sb.channel(`call:${ch.id}`, { config: { presence: { key: `lobby-${currentUserId}-${Math.random().toString(36).slice(2)}` } } });
        lobby
            .on("presence", { event: "sync" }, () => {
                const state = lobby.presenceState();
                const sample = Object.values(state).flat().filter(p => !String(p.key || "").startsWith("lobby-"));
                callLobbySubs.set(ch.id, { channel: lobby, members: sample });
                renderCallChannelsList();
            })
            .subscribe();
        callLobbySubs.set(ch.id, { channel: lobby, members: [] });
    });
}

function teardownAllLobbySubs() {
    callLobbySubs.forEach(entry => { try { sb.removeChannel(entry.channel); } catch (e) {} });
    callLobbySubs.clear();
}

function renderCallChannelsList() {
    const el = document.getElementById("callChannelsList");
    if (!el) return;

    if (!callChannelsList.length) {
        el.innerHTML = `<div class="card"><p class="muted">Пока нет ни одного канала — создай первый выше.</p></div>`;
        return;
    }

    el.innerHTML = callChannelsList.map(ch => {
        const isHere = ch.id === callState.channelId;
        const lobby = callLobbySubs.get(ch.id);
        const members = isHere
            ? Array.from(callState.members.values())
            : (lobby ? lobby.members : []);
        // я сам, если уже в этом канале
        const meMember = isHere ? [{ userId: currentUserId, name: getUser(currentUserId)?.display_name || "Я", avatar: getUser(currentUserId)?.avatar, video: callState.camOn, screen: callState.screenOn, muted: !callState.micOn }] : [];
        const all = [...meMember, ...members];

        const avatarsHtml = all.length
            ? `<div class="call-channel-members">${all.map(m => `
                <div class="call-member-chip" title="${escapeHtml(m.name || "")}">
                    <img src="${m.avatar || defaultAvatar()}">
                    ${m.muted ? '<span class="call-member-badge">🔇</span>' : ''}
                    ${m.video ? '<span class="call-member-badge call-member-badge-video">🎥</span>' : ''}
                    ${m.screen ? '<span class="call-member-badge call-member-badge-video">🖥️</span>' : ''}
                </div>
            `).join("")}</div>`
            : `<p class="muted" style="margin:6px 0 0;">Никого нет</p>`;

        const canDelete = ch.created_by === currentUserId;

        return `
            <div class="card call-channel-card">
                <div class="call-channel-head">
                    <div>
                        <h3 style="margin:0;">🔊 ${escapeHtml(ch.name)}</h3>
                        ${avatarsHtml}
                    </div>
                    <div class="call-channel-actions">
                        ${isHere
                            ? `<button class="secondary" onclick="leaveCallChannel()">Выйти</button>`
                            : `<button onclick="joinCallChannel('${ch.id}','${escapeHtml(ch.name).replace(/'/g, "\\'")}')">Войти</button>`}
                        ${canDelete ? `<button class="danger" onclick="deleteCallChannel('${ch.id}')" title="Удалить канал">🗑️</button>` : ""}
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

async function createCallChannel() {
    const input = document.getElementById("newCallChannelName");
    const name = (input?.value || "").trim();
    if (!name) { toast("Введи название канала."); return; }
    const { data, error } = await sb.from("call_channels").insert({ name, created_by: currentUserId }).select().single();
    if (error) { console.error(error); toast("Не удалось создать канал."); return; }
    callChannelsList.push(data);
    input.value = "";
    renderCallChannelsList();
}

async function deleteCallChannel(channelId) {
    if (callState.channelId === channelId) await leaveCallChannel();
    const { error } = await sb.from("call_channels").delete().eq("id", channelId);
    if (error) { console.error(error); toast("Не удалось удалить канал."); return; }
    callChannelsList = callChannelsList.filter(c => c.id !== channelId);
    const lobby = callLobbySubs.get(channelId);
    if (lobby) { try { sb.removeChannel(lobby.channel); } catch (e) {} callLobbySubs.delete(channelId); }
    renderCallChannelsList();
}

/* ------------------------------------------------------------
   ВХОД / ВЫХОД ИЗ ЗВОНКА
   ------------------------------------------------------------ */

async function joinCallChannel(channelId, channelName) {
    if (callState.channelId) {
        if (callState.channelId === channelId) return;
        await leaveCallChannel();
    }

    // Останавливаем "лобби"-подписку этого канала — дальше будем сидеть в нём по-настоящему.
    const lobby = callLobbySubs.get(channelId);
    if (lobby) { try { sb.removeChannel(lobby.channel); } catch (e) {} callLobbySubs.delete(channelId); }

    try {
        callState.localStream = await getMicStream();
    } catch (e) {
        console.error(e);
        toast("Не удалось получить доступ к микрофону. Проверь разрешения браузера.");
        return;
    }

    callState.channelId = channelId;
    callState.channelName = channelName;
    callState.micOn = true;
    callState.camOn = false;
    callState.screenOn = false;
    callState.members = new Map();
    callState.peers = new Map();

    const me = getUser(currentUserId);
    const channel = sb.channel(`call:${channelId}`, { config: { presence: { key: currentUserId } } });
    callState.presenceChannel = channel;

    channel
        .on("presence", { event: "sync" }, () => {
            const state = channel.presenceState();
            const seen = new Set();
            Object.entries(state).forEach(([userId, metas]) => {
                if (userId === currentUserId) return;
                seen.add(userId);
                const meta = metas[metas.length - 1];
                callState.members.set(userId, meta);
                ensurePeerConnection(userId);
            });
            // убираем тех, кто пропал из presence
            Array.from(callState.peers.keys()).forEach(userId => {
                if (!seen.has(userId)) closePeerConnection(userId);
            });
            renderCallBar();
            renderCallChannelsList();
        })
        .on("presence", { event: "leave" }, ({ key }) => {
            if (key === currentUserId) return;
            closePeerConnection(key);
            callState.members.delete(key);
            renderCallBar();
            renderCallChannelsList();
        })
        .on("broadcast", { event: "signal" }, ({ payload }) => {
            if (!payload || payload.to !== currentUserId) return;
            handleSignal(payload.from, payload.data);
        })
        .subscribe(async (status) => {
            if (status === "SUBSCRIBED") {
                await channel.track({
                    userId: currentUserId,
                    name: me?.display_name || me?.username || "Без имени",
                    avatar: me?.avatar || "",
                    video: false,
                    screen: false,
                    muted: false
                });
            }
        });

    renderCallBar();
    renderCallChannelsList();
    toast(`Заходим в канал «${channelName}»…`);
}

async function leaveCallChannel() {
    if (!callState.channelId) return;

    Array.from(callState.peers.keys()).forEach(closePeerConnection);

    if (callState.presenceChannel) {
        try { await callState.presenceChannel.untrack(); } catch (e) {}
        try { sb.removeChannel(callState.presenceChannel); } catch (e) {}
    }

    stopStream(callState.localStream);
    stopStream(callState.screenStream);

    callState = {
        channelId: null,
        channelName: "",
        presenceChannel: null,
        localStream: null,
        screenStream: null,
        peers: new Map(),
        members: new Map(),
        micOn: true,
        camOn: false,
        screenOn: false
    };

    renderCallBar();
    renderCallChannelsList();
}

function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
}

/* ------------------------------------------------------------
   МЕДИА (микрофон / камера / экран) — качество
   ------------------------------------------------------------ */

function getMicStream() {
    return navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: callSettings.micId ? { exact: callSettings.micId } : undefined,
            echoCancellation: callSettings.echoCancellation,
            noiseSuppression: callSettings.noiseSuppression,
            autoGainControl: callSettings.autoGainControl,
            channelCount: 2,
            sampleRate: 48000
        },
        video: false
    });
}

function getCamStream() {
    const q = CALL_QUALITY_PRESETS[callSettings.quality] || CALL_QUALITY_PRESETS.hd;
    return navigator.mediaDevices.getUserMedia({
        video: {
            deviceId: callSettings.camId ? { exact: callSettings.camId } : undefined,
            width: { ideal: q.width },
            height: { ideal: q.height },
            frameRate: { ideal: q.frameRate }
        }
    });
}

async function toggleMic() {
    if (!callState.channelId) return;
    callState.micOn = !callState.micOn;
    callState.localStream?.getAudioTracks().forEach(t => t.enabled = callState.micOn);
    await callState.presenceChannel?.track({ ...currentPresenceMeta(), muted: !callState.micOn });
    renderCallBar();
    renderCallChannelsList();
}

async function toggleCam() {
    if (!callState.channelId) return;
    if (callState.camOn) {
        callState.localStream?.getVideoTracks().forEach(t => { t.stop(); callState.localStream.removeTrack(t); });
        callState.camOn = false;
        callState.peers.forEach((peer, userId) => {
            const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === "video" && s.track.label !== "screen");
            if (sender) peer.pc.removeTrack(sender);
        });
    } else {
        try {
            const camStream = await getCamStream();
            const track = camStream.getVideoTracks()[0];
            callState.localStream.addTrack(track);
            callState.camOn = true;
            callState.peers.forEach((peer) => {
                const sender = peer.pc.addTrack(track, callState.localStream);
                applyEncodingBitrate(sender, CALL_QUALITY_PRESETS[callSettings.quality].videoBitrate);
            });
        } catch (e) {
            console.error(e);
            toast("Не удалось включить камеру. Проверь разрешения браузера.");
            return;
        }
    }
    await callState.presenceChannel?.track({ ...currentPresenceMeta(), video: callState.camOn });
    renderCallBar();
    renderCallChannelsList();
    renderCallSettingsModalIfOpen();
}

async function toggleScreenShare() {
    if (!callState.channelId) return;
    if (callState.screenOn) {
        stopStream(callState.screenStream);
        callState.screenStream = null;
        callState.screenOn = false;
        callState.peers.forEach((peer) => {
            const sender = peer.pc.getSenders().find(s => s.track && s.track.label === "screen");
            if (sender) peer.pc.removeTrack(sender);
        });
    } else {
        try {
            const q = CALL_QUALITY_PRESETS[callSettings.quality] || CALL_QUALITY_PRESETS.hd;
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: q.frameRate }, width: { ideal: q.width }, height: { ideal: q.height } },
                audio: false
            });
            const track = stream.getVideoTracks()[0];
            Object.defineProperty(track, "label", { value: "screen" }); // упрощает отличать поток экрана от камеры у отправителей
            track.onended = () => { if (callState.screenOn) toggleScreenShare(); };
            callState.screenStream = stream;
            callState.screenOn = true;
            callState.peers.forEach((peer) => {
                const sender = peer.pc.addTrack(track, stream);
                applyEncodingBitrate(sender, q.screenBitrate);
            });
        } catch (e) {
            console.error(e);
            if (e.name !== "NotAllowedError") toast("Не удалось начать показ экрана.");
            return;
        }
    }
    await callState.presenceChannel?.track({ ...currentPresenceMeta(), screen: callState.screenOn });
    renderCallBar();
}

function currentPresenceMeta() {
    const me = getUser(currentUserId);
    return {
        userId: currentUserId,
        name: me?.display_name || me?.username || "Без имени",
        avatar: me?.avatar || "",
        video: callState.camOn,
        screen: callState.screenOn,
        muted: !callState.micOn
    };
}

function applyEncodingBitrate(sender, bitrate) {
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = bitrate;
    sender.setParameters(params).catch(() => {});
}

// Поднимает битрейт Opus в самом SDP — setParameters на аудио-сендере
// битрейт не регулирует, это делается только через строку fmtp в SDP.
function boostOpusBitrate(sdp) {
    return sdp.replace(/a=fmtp:(\d+) minptime=10;useinbandfec=1/g, (m, pt) => `${m};maxaveragebitrate=${CALL_AUDIO_BITRATE};stereo=1;sprop-stereo=1`)
              .replace(/(m=audio.*\r?\n)/, `$1b=AS:${Math.round(CALL_AUDIO_BITRATE / 1000)}\r\n`);
}

/* ------------------------------------------------------------
   WEBRTC — perfect negotiation (устойчиво к гонкам offer/answer)
   ------------------------------------------------------------ */

const CALL_ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
];

function ensurePeerConnection(userId) {
    if (callState.peers.has(userId)) return callState.peers.get(userId);

    const polite = currentUserId > userId; // детерминированная роль по паре id, одинаковая с обеих сторон
    const pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS });
    const peer = { pc, polite, makingOffer: false, ignoreOffer: false, videoEl: null, screenEl: null };
    callState.peers.set(userId, peer);

    callState.localStream?.getTracks().forEach(track => {
        const sender = pc.addTrack(track, callState.localStream);
        if (track.kind === "video") applyEncodingBitrate(sender, CALL_QUALITY_PRESETS[callSettings.quality].videoBitrate);
    });
    if (callState.screenStream) {
        const track = callState.screenStream.getVideoTracks()[0];
        if (track) {
            const sender = pc.addTrack(track, callState.screenStream);
            applyEncodingBitrate(sender, CALL_QUALITY_PRESETS[callSettings.quality].screenBitrate);
        }
    }

    pc.onnegotiationneeded = async () => {
        try {
            peer.makingOffer = true;
            await pc.setLocalDescription();
            sendSignal(userId, { description: pc.localDescription });
        } catch (e) {
            console.error(e);
        } finally {
            peer.makingOffer = false;
        }
    };

    pc.onicecandidate = ({ candidate }) => {
        if (candidate) sendSignal(userId, { candidate });
    };

    pc.ontrack = (event) => {
        const isScreen = event.track.label === "screen" || (event.transceiver?.sender?.track?.label === "screen");
        renderRemoteTrack(userId, event.streams[0] || new MediaStream([event.track]), event.track.kind, isScreen);
    };

    pc.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
            // не закрываем сразу на "disconnected" — часто восстанавливается само;
            // окончательно чистим только когда presence подтвердит уход участника.
        }
    };

    return peer;
}

function closePeerConnection(userId) {
    const peer = callState.peers.get(userId);
    if (!peer) return;
    try { peer.pc.close(); } catch (e) {}
    callState.peers.delete(userId);
    removeRemoteTiles(userId);
}

function sendSignal(toUserId, data) {
    callState.presenceChannel?.send({ type: "broadcast", event: "signal", payload: { to: toUserId, from: currentUserId, data } });
}

async function handleSignal(fromUserId, data) {
    const peer = ensurePeerConnection(fromUserId);
    const { pc } = peer;

    try {
        if (data.description) {
            const offerCollision = data.description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
            peer.ignoreOffer = !peer.polite && offerCollision;
            if (peer.ignoreOffer) return;

            let desc = data.description;
            if (desc.type === "offer" || desc.type === "answer") {
                desc = { ...desc, sdp: desc.sdp && desc.sdp.includes("m=audio") ? boostOpusBitrate(desc.sdp) : desc.sdp };
            }
            await pc.setRemoteDescription(desc);
            if (data.description.type === "offer") {
                await pc.setLocalDescription();
                sendSignal(fromUserId, { description: pc.localDescription });
            }
        } else if (data.candidate) {
            try { await pc.addIceCandidate(data.candidate); }
            catch (e) { if (!peer.ignoreOffer) console.error(e); }
        }
    } catch (e) {
        console.error("Ошибка сигналинга звонка:", e);
    }
}

/* ------------------------------------------------------------
   ПЛАВАЮЩАЯ ПАНЕЛЬ ЗВОНКА + СЕТКА ВИДЕО
   ------------------------------------------------------------ */

function renderRemoteTrack(userId, stream, kind, isScreen) {
    renderCallBar(); // на случай если плитки участника ещё нет
    requestAnimationFrame(() => {
        const key = isScreen ? `screen-${userId}` : `cam-${userId}`;
        const el = document.getElementById(`callTile-${key}`);
        if (!el) return;
        if (kind === "video") {
            el.srcObject = stream;
        } else if (kind === "audio") {
            const audioEl = document.getElementById(`callAudio-${userId}`);
            if (audioEl) {
                audioEl.srcObject = stream;
                if (callSettings.speakerId && audioEl.setSinkId) audioEl.setSinkId(callSettings.speakerId).catch(() => {});
            }
        }
    });
}

function removeRemoteTiles(userId) {
    renderCallBar();
}

function renderCallBar() {
    const bar = document.getElementById("callBar");
    if (!bar) return;

    if (!callState.channelId) {
        bar.classList.add("hidden");
        bar.innerHTML = "";
        return;
    }

    bar.classList.remove("hidden");

    const tiles = [];
    // моя камера
    if (callState.camOn) tiles.push(renderLocalTile("cam"));
    if (callState.screenOn) tiles.push(renderLocalTile("screen"));

    callState.members.forEach((meta, userId) => {
        if (meta.video) tiles.push(`<div class="call-tile"><video id="callTile-cam-${userId}" autoplay playsinline></video><div class="call-tile-label">${escapeHtml(meta.name || "")}</div></div>`);
        if (meta.screen) tiles.push(`<div class="call-tile call-tile-screen"><video id="callTile-screen-${userId}" autoplay playsinline></video><div class="call-tile-label">🖥️ ${escapeHtml(meta.name || "")}</div></div>`);
    });

    const audioEls = Array.from(callState.members.keys()).map(userId => `<audio id="callAudio-${userId}" autoplay></audio>`).join("");

    bar.innerHTML = `
        ${audioEls}
        <div class="call-bar-top">
            <div class="call-bar-title">🔊 ${escapeHtml(callState.channelName)} · ${callState.members.size + 1}</div>
            <button class="call-btn call-btn-leave" onclick="leaveCallChannel()" title="Выйти">✕</button>
        </div>
        ${tiles.length ? `<div class="call-tiles">${tiles.join("")}</div>` : ""}
        <div class="call-bar-controls">
            <button class="call-btn ${callState.micOn ? "" : "call-btn-off"}" onclick="toggleMic()" title="${callState.micOn ? "Выключить микрофон" : "Включить микрофон"}">${callState.micOn ? "🎙️" : "🔇"}</button>
            <button class="call-btn ${callState.camOn ? "call-btn-on" : ""}" onclick="toggleCam()" title="${callState.camOn ? "Выключить камеру" : "Включить камеру"}">🎥</button>
            <button class="call-btn ${callState.screenOn ? "call-btn-on" : ""}" onclick="toggleScreenShare()" title="${callState.screenOn ? "Остановить показ экрана" : "Показать экран"}">🖥️</button>
            <button class="call-btn" onclick="openCallSettings()" title="Настройки звонка">⚙️</button>
        </div>
    `;

    // локальные видео-элементы — присваиваем srcObject после вставки в DOM
    requestAnimationFrame(() => {
        if (callState.camOn) {
            const v = document.getElementById("callTile-cam-me");
            if (v) v.srcObject = callState.localStream;
        }
        if (callState.screenOn) {
            const v = document.getElementById("callTile-screen-me");
            if (v) v.srcObject = callState.screenStream;
        }
        // переустанавливаем удалённые потоки, если элементы только что пересозданы
        callState.peers.forEach((peer, userId) => {
            peer.pc.getReceivers().forEach(r => {
                if (!r.track) return;
                const isScreen = r.track.label === "screen";
                renderRemoteTrack(userId, new MediaStream([r.track]), r.track.kind, isScreen);
            });
        });
    });
}

function renderLocalTile(kind) {
    const isScreen = kind === "screen";
    return `<div class="call-tile ${isScreen ? "call-tile-screen" : ""}">
        <video id="callTile-${kind}-me" autoplay playsinline muted></video>
        <div class="call-tile-label">${isScreen ? "🖥️ Ты (экран)" : "Ты"}</div>
    </div>`;
}

/* ------------------------------------------------------------
   НАСТРОЙКИ (микрофон / камера / динамик / качество)
   ------------------------------------------------------------ */

let callSettingsModalOpen = false;

async function openCallSettings() {
    callSettingsModalOpen = true;
    let devices = [];
    try {
        // просим доступ заранее, иначе enumerateDevices не отдаёт понятные labels
        if (!callState.localStream) await getMicStream().then(s => stopStream(s));
        devices = await navigator.mediaDevices.enumerateDevices();
    } catch (e) { console.error(e); }

    const mics = devices.filter(d => d.kind === "audioinput");
    const cams = devices.filter(d => d.kind === "videoinput");
    const speakers = devices.filter(d => d.kind === "audiooutput");

    showBubblesModal(callSettingsModalHtml(mics, cams, speakers));
}

function callSettingsModalHtml(mics, cams, speakers) {
    const opt = (list, selected, fallbackLabel) => list.map((d, i) =>
        `<option value="${d.deviceId}" ${d.deviceId === selected ? "selected" : ""}>${escapeHtml(d.label || `${fallbackLabel} ${i + 1}`)}</option>`
    ).join("");

    return `
        <div class="modal-header">
            <h3>Настройки звонка</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>

        <label class="call-settings-label">Микрофон</label>
        <select id="callSettingMic" onchange="applyCallSettingsFromModal()">
            <option value="">По умолчанию</option>
            ${opt(mics, callSettings.micId, "Микрофон")}
        </select>

        <label class="call-settings-label">Камера</label>
        <select id="callSettingCam" onchange="applyCallSettingsFromModal()">
            <option value="">По умолчанию</option>
            ${opt(cams, callSettings.camId, "Камера")}
        </select>

        ${speakers.length ? `
        <label class="call-settings-label">Динамик</label>
        <select id="callSettingSpeaker" onchange="applyCallSettingsFromModal()">
            <option value="">По умолчанию</option>
            ${opt(speakers, callSettings.speakerId, "Динамик")}
        </select>
        ` : ""}

        <label class="call-settings-label">Качество видео</label>
        <select id="callSettingQuality" onchange="applyCallSettingsFromModal()">
            ${Object.entries(CALL_QUALITY_PRESETS).map(([key, p]) => `<option value="${key}" ${key === callSettings.quality ? "selected" : ""}>${p.label}</option>`).join("")}
        </select>

        <div class="call-settings-toggles">
            <label><input type="checkbox" id="callSettingEcho" ${callSettings.echoCancellation ? "checked" : ""} onchange="applyCallSettingsFromModal()"> Подавление эха</label>
            <label><input type="checkbox" id="callSettingNoise" ${callSettings.noiseSuppression ? "checked" : ""} onchange="applyCallSettingsFromModal()"> Шумоподавление</label>
            <label><input type="checkbox" id="callSettingAgc" ${callSettings.autoGainControl ? "checked" : ""} onchange="applyCallSettingsFromModal()"> Автогромкость микрофона</label>
        </div>

        <p class="muted" style="margin-top:10px;">Смена микрофона/камеры применится сразу в текущем звонке. Качество видео — при следующем включении камеры или показа экрана.</p>
    `;
}

function renderCallSettingsModalIfOpen() {
    if (callSettingsModalOpen && document.getElementById("bubblesModalOverlay")) openCallSettings();
}

async function applyCallSettingsFromModal() {
    const micSel = document.getElementById("callSettingMic");
    const camSel = document.getElementById("callSettingCam");
    const spkSel = document.getElementById("callSettingSpeaker");
    const qSel = document.getElementById("callSettingQuality");

    const micChanged = micSel && micSel.value !== callSettings.micId;
    const camChanged = camSel && camSel.value !== callSettings.camId;

    callSettings.micId = micSel ? micSel.value : callSettings.micId;
    callSettings.camId = camSel ? camSel.value : callSettings.camId;
    callSettings.speakerId = spkSel ? spkSel.value : callSettings.speakerId;
    callSettings.quality = qSel ? qSel.value : callSettings.quality;
    callSettings.echoCancellation = document.getElementById("callSettingEcho")?.checked ?? callSettings.echoCancellation;
    callSettings.noiseSuppression = document.getElementById("callSettingNoise")?.checked ?? callSettings.noiseSuppression;
    callSettings.autoGainControl = document.getElementById("callSettingAgc")?.checked ?? callSettings.autoGainControl;
    saveCallSettings();

    if (callState.channelId && micChanged) await swapMicDevice();
    if (callState.channelId && callState.camOn && camChanged) await swapCamDevice();
    if (callState.channelId) applyOutputDeviceToAudioEls();
}

async function swapMicDevice() {
    try {
        const newStream = await getMicStream();
        const newTrack = newStream.getAudioTracks()[0];
        newTrack.enabled = callState.micOn;
        const oldTrack = callState.localStream.getAudioTracks()[0];
        if (oldTrack) { callState.localStream.removeTrack(oldTrack); oldTrack.stop(); }
        callState.localStream.addTrack(newTrack);
        callState.peers.forEach(peer => {
            const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === "audio");
            if (sender) sender.replaceTrack(newTrack);
        });
    } catch (e) { console.error(e); toast("Не удалось переключить микрофон."); }
}

async function swapCamDevice() {
    try {
        const camStream = await getCamStream();
        const newTrack = camStream.getVideoTracks()[0];
        const oldTrack = callState.localStream.getVideoTracks()[0];
        if (oldTrack) { callState.localStream.removeTrack(oldTrack); oldTrack.stop(); }
        callState.localStream.addTrack(newTrack);
        callState.peers.forEach(peer => {
            const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === "video" && s.track.label !== "screen");
            if (sender) { sender.replaceTrack(newTrack); applyEncodingBitrate(sender, CALL_QUALITY_PRESETS[callSettings.quality].videoBitrate); }
        });
        const v = document.getElementById("callTile-cam-me");
        if (v) v.srcObject = callState.localStream;
    } catch (e) { console.error(e); toast("Не удалось переключить камеру."); }
}

function applyOutputDeviceToAudioEls() {
    if (!callSettings.speakerId) return;
    document.querySelectorAll('audio[id^="callAudio-"]').forEach(el => {
        if (el.setSinkId) el.setSinkId(callSettings.speakerId).catch(() => {});
    });
}

// закрываем флаг модалки, когда её закрывают обычным способом
const _origCloseBubblesModal = closeBubblesModal;
closeBubblesModal = function () {
    callSettingsModalOpen = false;
    _origCloseBubblesModal();
};

// на всякий случай — не оставляем открытые устройства/соединения, если вкладку закрывают
window.addEventListener("beforeunload", () => {
    if (callState.channelId) {
        stopStream(callState.localStream);
        stopStream(callState.screenStream);
    }
});
