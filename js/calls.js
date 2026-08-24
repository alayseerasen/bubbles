/* ============================================================
   BUBBLES — ЗВОНКИ В ЛИЧНЫХ СООБЩЕНИЯХ
   ------------------------------------------------------------
   Звонишь конкретному другу прямо из чата: кнопка 📞 в шапке
   переписки. У получателя, если он online (открыт сайт),
   выскакивает окно "входящий звонок" с приёмом/отклонением.
   Внутри звонка — голос, видео с камеры, показ экрана,
   настройки микрофона/камеры/динамика и качества.

   Технически — P2P WebRTC, без медиа-сервера. Сигналинг (кто кому
   звонит, обмен offer/answer/ICE) идёт через Supabase Realtime
   Broadcast, ничего не пишется в базу — всё эфемерно, как и
   typing-индикатор в чате.

   Ограничение такого подхода: звонок долетит, только если у
   собеседника открыта вкладка с сайтом в этот момент — офлайн-пуша
   на "тебе звонят" здесь нет (это отдельная, более сложная тема).
   ============================================================ */

const CALL_QUALITY_PRESETS = {
    sd:  { label: "SD (480p)",  width: 640,  height: 480,  frameRate: 24, videoBitrate: 700_000,   screenBitrate: 1_500_000 },
    hd:  { label: "HD (720p)",  width: 1280, height: 720,  frameRate: 30, videoBitrate: 2_000_000, screenBitrate: 3_000_000 },
    fhd: { label: "Full HD (1080p)", width: 1920, height: 1080, frameRate: 30, videoBitrate: 3_500_000, screenBitrate: 5_000_000 }
};

const CALL_AUDIO_BITRATE = 128_000; // opus, бит/с — заметно лучше дефолтных ~32кбит/с
const CALL_RING_TIMEOUT_MS = 45_000;

const CALL_ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
];

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
let ringChannel = null; // персональный канал "мне звонят", живёт всё время, пока открыт сайт

// status: "idle" | "calling" (я звоню, жду ответа) | "ringing" (мне звонят) | "connected"
let callState = {
    status: "idle",
    callId: null,
    remoteUserId: null,
    remoteName: "",
    remoteAvatar: "",
    channel: null,
    pc: null,
    polite: false,
    makingOffer: false,
    ignoreOffer: false,
    localStream: null,
    screenStream: null,
    micOn: true,
    camOn: false,
    screenOn: false,
    remoteVideoOn: false,
    remoteScreenOn: false,
    ringTimeout: null,
    stopRingtone: null
};

/* ------------------------------------------------------------
   ПЕРСОНАЛЬНЫЙ КАНАЛ "МНЕ ЗВОНЯТ" — живёт всё время сессии
   ------------------------------------------------------------ */

function initCallSignaling() {
    teardownCallSignaling();
    if (!currentUserId) return;
    ringChannel = sb.channel("call-ring-" + currentUserId)
        .on("broadcast", { event: "invite" }, ({ payload }) => handleIncomingInvite(payload))
        .on("broadcast", { event: "cancel" }, ({ payload }) => {
            if (callState.status === "ringing" && callState.callId === payload.callId) endCallLocally("Звонок отменён.");
        })
        .on("broadcast", { event: "decline" }, ({ payload }) => {
            if (callState.status === "calling" && callState.callId === payload.callId) endCallLocally(payload.reason === "busy" ? "Собеседник сейчас на другом звонке." : "Звонок отклонён.");
        })
        .subscribe();
}

function teardownCallSignaling() {
    if (ringChannel) { try { sb.removeChannel(ringChannel); } catch (e) {} ringChannel = null; }
    if (callState.status !== "idle") endCallLocally();
}

function handleIncomingInvite(payload) {
    if (callState.status !== "idle") {
        // Уже на другом звонке — сразу "занято", не мучаем модалкой.
        sb.channel("call-ring-" + payload.from).send({ type: "broadcast", event: "decline", payload: { callId: payload.callId, reason: "busy" } })
            .then(() => {});
        return;
    }

    callState.status = "ringing";
    callState.callId = payload.callId;
    callState.remoteUserId = payload.from;
    callState.remoteName = payload.name || "Кто-то";
    callState.remoteAvatar = payload.avatar || "";

    playRingtone();
    renderIncomingCallModal();

    callState.ringTimeout = setTimeout(() => {
        if (callState.status === "ringing") endCallLocally("Пропущенный звонок.");
    }, CALL_RING_TIMEOUT_MS);
}

/* ------------------------------------------------------------
   ИСХОДЯЩИЙ ЗВОНОК
   ------------------------------------------------------------ */

async function startDirectCall(partnerId) {
    if (callState.status !== "idle") { toast("Ты уже на звонке."); return; }

    const partner = getUser(partnerId);
    if (!partner) return;

    let localStream;
    try {
        localStream = await getMicStream();
    } catch (e) {
        console.error(e);
        toast("Не удалось получить доступ к микрофону. Проверь разрешения браузера.");
        return;
    }

    const me = getUser(currentUserId);
    const callId = (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(36).slice(2)));

    callState.status = "calling";
    callState.callId = callId;
    callState.remoteUserId = partnerId;
    callState.remoteName = partner.displayName;
    callState.remoteAvatar = partner.avatar;
    callState.localStream = localStream;
    callState.polite = currentUserId > partnerId; // одинаковая детерминированная роль с обеих сторон

    joinCallChannel(callId, partnerId);

    sb.channel("call-ring-" + partnerId).send({
        type: "broadcast",
        event: "invite",
        payload: { callId, from: currentUserId, name: me?.displayName || "Кто-то", avatar: me?.avatar || "" }
    });

    renderOutgoingCallModal();

    callState.ringTimeout = setTimeout(() => {
        if (callState.status === "calling") {
            sb.channel("call-ring-" + partnerId).send({ type: "broadcast", event: "cancel", payload: { callId } });
            endCallLocally("Абонент не отвечает.");
        }
    }, CALL_RING_TIMEOUT_MS);
}

function cancelOutgoingCall() {
    if (callState.status !== "calling") return;
    sb.channel("call-ring-" + callState.remoteUserId).send({ type: "broadcast", event: "cancel", payload: { callId: callState.callId } });
    endCallLocally();
}

/* ------------------------------------------------------------
   ПРИНЯТЬ / ОТКЛОНИТЬ ВХОДЯЩИЙ
   ------------------------------------------------------------ */

async function acceptIncomingCall() {
    if (callState.status !== "ringing") return;
    stopRingtone();
    closeBubblesModal();

    let localStream;
    try {
        localStream = await getMicStream();
    } catch (e) {
        console.error(e);
        toast("Не удалось получить доступ к микрофону. Проверь разрешения браузера.");
        declineIncomingCall();
        return;
    }

    callState.localStream = localStream;
    callState.polite = currentUserId > callState.remoteUserId;
    if (callState.ringTimeout) { clearTimeout(callState.ringTimeout); callState.ringTimeout = null; }

    joinCallChannel(callState.callId, callState.remoteUserId);
}

function declineIncomingCall() {
    if (callState.status !== "ringing") return;
    sb.channel("call-ring-" + callState.remoteUserId).send({ type: "broadcast", event: "decline", payload: { callId: callState.callId } });
    stopRingtone();
    closeBubblesModal();
    endCallLocally();
}

/* ------------------------------------------------------------
   КАНАЛ ЗВОНКА (сигналинг + сам WebRTC)
   ------------------------------------------------------------ */

function joinCallChannel(callId, partnerId) {
    const channel = sb.channel("call:" + callId)
        .on("broadcast", { event: "signal" }, ({ payload }) => {
            if (payload.to !== currentUserId) return;
            handleSignal(payload.data);
        })
        .on("broadcast", { event: "state" }, ({ payload }) => {
            if (payload.from !== callState.remoteUserId) return;
            callState.remoteVideoOn = !!payload.video;
            callState.remoteScreenOn = !!payload.screen;
            renderCallBar();
        })
        .on("broadcast", { event: "hangup" }, ({ payload }) => {
            if (payload.from !== callState.remoteUserId) return;
            endCallLocally("Собеседник завершил звонок.");
        })
        .subscribe();

    callState.channel = channel;
    callState.status = "connected";
    setupPeerConnection();
    renderCallBar();
}

function setupPeerConnection() {
    const pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS });
    callState.pc = pc;

    callState.localStream?.getTracks().forEach(track => {
        const sender = pc.addTrack(track, callState.localStream);
        if (track.kind === "video") applyEncodingBitrate(sender, CALL_QUALITY_PRESETS[callSettings.quality].videoBitrate);
    });

    pc.onnegotiationneeded = async () => {
        try {
            callState.makingOffer = true;
            await pc.setLocalDescription();
            sendSignal({ description: pc.localDescription });
        } catch (e) {
            console.error(e);
        } finally {
            callState.makingOffer = false;
        }
    };

    pc.onicecandidate = ({ candidate }) => { if (candidate) sendSignal({ candidate }); };

    pc.ontrack = (event) => {
        const isScreen = event.track.label === "screen";
        requestAnimationFrame(() => {
            const el = document.getElementById(isScreen ? "callTile-screen-remote" : "callTile-cam-remote");
            if (el && event.track.kind === "video") el.srcObject = event.streams[0] || new MediaStream([event.track]);
            if (event.track.kind === "audio") {
                const audioEl = document.getElementById("callRemoteAudio");
                if (audioEl) {
                    audioEl.srcObject = event.streams[0] || new MediaStream([event.track]);
                    if (callSettings.speakerId && audioEl.setSinkId) audioEl.setSinkId(callSettings.speakerId).catch(() => {});
                }
            }
        });
    };

    let connectedSoundPlayed = false;
    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected" && !connectedSoundPlayed) {
            connectedSoundPlayed = true;
            playSound("callConnect");
        }
        if (pc.connectionState === "failed") toast("Связь со собеседником прервалась.");
    };
}

function sendSignal(data) {
    callState.channel?.send({ type: "broadcast", event: "signal", payload: { to: callState.remoteUserId, from: currentUserId, data } });
}

async function handleSignal(data) {
    const pc = callState.pc;
    if (!pc) return;
    try {
        if (data.description) {
            const offerCollision = data.description.type === "offer" && (callState.makingOffer || pc.signalingState !== "stable");
            callState.ignoreOffer = !callState.polite && offerCollision;
            if (callState.ignoreOffer) return;

            let desc = data.description;
            if ((desc.type === "offer" || desc.type === "answer") && desc.sdp && desc.sdp.includes("m=audio")) {
                desc = { ...desc, sdp: boostOpusBitrate(desc.sdp) };
            }
            await pc.setRemoteDescription(desc);
            if (data.description.type === "offer") {
                await pc.setLocalDescription();
                sendSignal({ description: pc.localDescription });
            }
        } else if (data.candidate) {
            try { await pc.addIceCandidate(data.candidate); }
            catch (e) { if (!callState.ignoreOffer) console.error(e); }
        }
    } catch (e) {
        console.error("Ошибка сигналинга звонка:", e);
    }
}

function broadcastMyState() {
    callState.channel?.send({ type: "broadcast", event: "state", payload: { from: currentUserId, video: callState.camOn, screen: callState.screenOn } });
}

/* ------------------------------------------------------------
   ЗАВЕРШЕНИЕ ЗВОНКА
   ------------------------------------------------------------ */

function hangUpCall() {
    if (callState.status === "calling") { cancelOutgoingCall(); return; }
    if (callState.status === "ringing") { declineIncomingCall(); return; }
    callState.channel?.send({ type: "broadcast", event: "hangup", payload: { from: currentUserId } });
    endCallLocally();
}

function endCallLocally(toastMessage) {
    if (callState.ringTimeout) { clearTimeout(callState.ringTimeout); callState.ringTimeout = null; }
    stopRingtone();
    try { closeBubblesModal(); } catch (e) {}
    if (callState.status !== "idle") playSound("callEnd");

    try { callState.pc?.close(); } catch (e) {}
    stopStream(callState.localStream);
    stopStream(callState.screenStream);
    if (callState.channel) { try { sb.removeChannel(callState.channel); } catch (e) {} }

    const wasStatus = callState.status;
    callState = {
        status: "idle", callId: null, remoteUserId: null, remoteName: "", remoteAvatar: "",
        channel: null, pc: null, polite: false, makingOffer: false, ignoreOffer: false,
        localStream: null, screenStream: null, micOn: true, camOn: false, screenOn: false,
        remoteVideoOn: false, remoteScreenOn: false, ringTimeout: null, stopRingtone: null
    };

    renderCallBar();
    if (toastMessage && wasStatus !== "idle") toast(toastMessage);
}

function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
}

/* ------------------------------------------------------------
   МЕДИА — микрофон / камера / экран, качество
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
    if (callState.status !== "connected") return;
    callState.micOn = !callState.micOn;
    callState.localStream?.getAudioTracks().forEach(t => t.enabled = callState.micOn);
    renderCallBar();
}

async function toggleCam() {
    if (callState.status !== "connected") return;
    if (callState.camOn) {
        callState.localStream?.getVideoTracks().forEach(t => { t.stop(); callState.localStream.removeTrack(t); });
        const sender = callState.pc.getSenders().find(s => s.track && s.track.kind === "video" && s.track.label !== "screen");
        if (sender) callState.pc.removeTrack(sender);
        callState.camOn = false;
    } else {
        try {
            const camStream = await getCamStream();
            const track = camStream.getVideoTracks()[0];
            callState.localStream.addTrack(track);
            const sender = callState.pc.addTrack(track, callState.localStream);
            applyEncodingBitrate(sender, CALL_QUALITY_PRESETS[callSettings.quality].videoBitrate);
            callState.camOn = true;
        } catch (e) {
            console.error(e);
            toast("Не удалось включить камеру. Проверь разрешения браузера.");
            return;
        }
    }
    broadcastMyState();
    renderCallBar();
    renderCallSettingsModalIfOpen();
}

async function toggleScreenShare() {
    if (callState.status !== "connected") return;
    if (callState.screenOn) {
        stopStream(callState.screenStream);
        callState.screenStream = null;
        const sender = callState.pc.getSenders().find(s => s.track && s.track.label === "screen");
        if (sender) callState.pc.removeTrack(sender);
        callState.screenOn = false;
    } else {
        try {
            const q = CALL_QUALITY_PRESETS[callSettings.quality] || CALL_QUALITY_PRESETS.hd;
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: q.frameRate }, width: { ideal: q.width }, height: { ideal: q.height } },
                audio: false
            });
            const track = stream.getVideoTracks()[0];
            Object.defineProperty(track, "label", { value: "screen" });
            track.onended = () => { if (callState.screenOn) toggleScreenShare(); };
            callState.screenStream = stream;
            const sender = callState.pc.addTrack(track, stream);
            applyEncodingBitrate(sender, q.screenBitrate);
            callState.screenOn = true;
        } catch (e) {
            console.error(e);
            if (e.name !== "NotAllowedError") toast("Не удалось начать показ экрана.");
            return;
        }
    }
    broadcastMyState();
    renderCallBar();
}

function applyEncodingBitrate(sender, bitrate) {
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = bitrate;
    sender.setParameters(params).catch(() => {});
}

// setParameters на аудио-сендере битрейт Opus не регулирует — это делается
// только через строку fmtp в самом SDP.
function boostOpusBitrate(sdp) {
    return sdp.replace(/a=fmtp:(\d+) minptime=10;useinbandfec=1/g, (m) => `${m};maxaveragebitrate=${CALL_AUDIO_BITRATE};stereo=1;sprop-stereo=1`)
              .replace(/(m=audio.*\r?\n)/, `$1b=AS:${Math.round(CALL_AUDIO_BITRATE / 1000)}\r\n`);
}

/* ------------------------------------------------------------
   РИНГТОН (простой сигнал через Web Audio, без файлов)
   ------------------------------------------------------------ */

function playRingtone() {
    callState.stopRingtone = startSoundLoop("ring", 1500);
}

function stopRingtone() {
    if (callState.stopRingtone) { callState.stopRingtone(); callState.stopRingtone = null; }
}

/* ------------------------------------------------------------
   UI — модалки входящего/исходящего звонка
   ------------------------------------------------------------ */

function renderIncomingCallModal() {
    showBubblesModal(`
        <div class="call-modal">
            <img class="call-modal-avatar call-modal-avatar-pulse" src="${callState.remoteAvatar || defaultAvatar()}">
            <h3>${escapeHtml(callState.remoteName)}</h3>
            <p class="muted">Входящий звонок…</p>
            <div class="call-modal-actions">
                <button class="call-btn call-btn-accept" onclick="acceptIncomingCall()" title="Принять">📞</button>
                <button class="call-btn call-btn-off" onclick="declineIncomingCall()" title="Отклонить">✕</button>
            </div>
        </div>
    `);
}

function renderOutgoingCallModal() {
    showBubblesModal(`
        <div class="call-modal">
            <img class="call-modal-avatar call-modal-avatar-pulse" src="${callState.remoteAvatar || defaultAvatar()}">
            <h3>${escapeHtml(callState.remoteName)}</h3>
            <p class="muted">Звоним…</p>
            <div class="call-modal-actions">
                <button class="call-btn call-btn-off" onclick="cancelOutgoingCall()" title="Отменить">✕</button>
            </div>
        </div>
    `);
}

/* ------------------------------------------------------------
   ПАНЕЛЬ АКТИВНОГО ЗВОНКА
   ------------------------------------------------------------ */

function renderCallBar() {
    const bar = document.getElementById("callBar");
    if (!bar) return;

    if (callState.status !== "connected") {
        bar.classList.add("hidden");
        bar.innerHTML = "";
        return;
    }

    bar.classList.remove("hidden");

    const tiles = [];
    if (callState.camOn) tiles.push(`<div class="call-tile"><video id="callTile-cam-me" autoplay playsinline muted></video><div class="call-tile-label">Ты</div></div>`);
    if (callState.screenOn) tiles.push(`<div class="call-tile call-tile-screen"><video id="callTile-screen-me" autoplay playsinline muted></video><div class="call-tile-label">🖥️ Ты (экран)</div></div>`);
    if (callState.remoteVideoOn) tiles.push(`<div class="call-tile"><video id="callTile-cam-remote" autoplay playsinline></video><div class="call-tile-label">${escapeHtml(callState.remoteName)}</div></div>`);
    if (callState.remoteScreenOn) tiles.push(`<div class="call-tile call-tile-screen"><video id="callTile-screen-remote" autoplay playsinline></video><div class="call-tile-label">🖥️ ${escapeHtml(callState.remoteName)}</div></div>`);

    bar.innerHTML = `
        <audio id="callRemoteAudio" autoplay></audio>
        <div class="call-bar-top">
            <div class="call-bar-title">📞 ${escapeHtml(callState.remoteName)}</div>
            <button class="call-btn call-btn-leave" onclick="hangUpCall()" title="Завершить">✕</button>
        </div>
        ${tiles.length ? `<div class="call-tiles">${tiles.join("")}</div>` : `<p class="muted call-bar-audio-only">Только голос</p>`}
        <div class="call-bar-controls">
            <button class="call-btn ${callState.micOn ? "" : "call-btn-off"}" onclick="toggleMic()" title="${callState.micOn ? "Выключить микрофон" : "Включить микрофон"}">${callState.micOn ? "🎙️" : "🔇"}</button>
            <button class="call-btn ${callState.camOn ? "call-btn-on" : ""}" onclick="toggleCam()" title="${callState.camOn ? "Выключить камеру" : "Включить камеру"}">🎥</button>
            <button class="call-btn ${callState.screenOn ? "call-btn-on" : ""}" onclick="toggleScreenShare()" title="${callState.screenOn ? "Остановить показ экрана" : "Показать экран"}">🖥️</button>
            <button class="call-btn" onclick="openCallSettings()" title="Настройки звонка">⚙️</button>
        </div>
    `;

    requestAnimationFrame(() => {
        if (callState.camOn) { const v = document.getElementById("callTile-cam-me"); if (v) v.srcObject = callState.localStream; }
        if (callState.screenOn) { const v = document.getElementById("callTile-screen-me"); if (v) v.srcObject = callState.screenStream; }
        // переустанавливаем удалённые потоки, если плитки только что пересозданы
        callState.pc?.getReceivers().forEach(r => {
            if (!r.track) return;
            const isScreen = r.track.label === "screen";
            const el = document.getElementById(isScreen ? "callTile-screen-remote" : "callTile-cam-remote");
            if (el && r.track.kind === "video") el.srcObject = new MediaStream([r.track]);
        });
        const audioEl = document.getElementById("callRemoteAudio");
        if (audioEl && callSettings.speakerId && audioEl.setSinkId) audioEl.setSinkId(callSettings.speakerId).catch(() => {});
    });
}

/* ------------------------------------------------------------
   НАСТРОЙКИ (микрофон / камера / динамик / качество)
   ------------------------------------------------------------ */

let callSettingsModalOpen = false;

async function openCallSettings() {
    callSettingsModalOpen = true;
    let devices = [];
    try {
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

        <p class="muted" style="margin-top:10px;">Смена микрофона/камеры применится сразу, если звонок уже идёт. Качество видео — при следующем включении камеры или показа экрана.</p>
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

    if (callState.status === "connected" && micChanged) await swapMicDevice();
    if (callState.status === "connected" && callState.camOn && camChanged) await swapCamDevice();
    if (callState.status === "connected") applyOutputDeviceToAudioEl();
}

async function swapMicDevice() {
    try {
        const newStream = await getMicStream();
        const newTrack = newStream.getAudioTracks()[0];
        newTrack.enabled = callState.micOn;
        const oldTrack = callState.localStream.getAudioTracks()[0];
        if (oldTrack) { callState.localStream.removeTrack(oldTrack); oldTrack.stop(); }
        callState.localStream.addTrack(newTrack);
        const sender = callState.pc.getSenders().find(s => s.track && s.track.kind === "audio");
        if (sender) sender.replaceTrack(newTrack);
    } catch (e) { console.error(e); toast("Не удалось переключить микрофон."); }
}

async function swapCamDevice() {
    try {
        const camStream = await getCamStream();
        const newTrack = camStream.getVideoTracks()[0];
        const oldTrack = callState.localStream.getVideoTracks()[0];
        if (oldTrack) { callState.localStream.removeTrack(oldTrack); oldTrack.stop(); }
        callState.localStream.addTrack(newTrack);
        const sender = callState.pc.getSenders().find(s => s.track && s.track.kind === "video" && s.track.label !== "screen");
        if (sender) { sender.replaceTrack(newTrack); applyEncodingBitrate(sender, CALL_QUALITY_PRESETS[callSettings.quality].videoBitrate); }
        const v = document.getElementById("callTile-cam-me");
        if (v) v.srcObject = callState.localStream;
    } catch (e) { console.error(e); toast("Не удалось переключить камеру."); }
}

function applyOutputDeviceToAudioEl() {
    if (!callSettings.speakerId) return;
    const el = document.getElementById("callRemoteAudio");
    if (el && el.setSinkId) el.setSinkId(callSettings.speakerId).catch(() => {});
}

// сбрасываем флаг модалки, когда её закрывают обычным способом
const _origCloseBubblesModal = closeBubblesModal;
closeBubblesModal = function () {
    callSettingsModalOpen = false;
    _origCloseBubblesModal();
};

// не оставляем открытые устройства/соединения, если вкладку закрывают
window.addEventListener("beforeunload", () => {
    if (callState.status !== "idle") {
        stopStream(callState.localStream);
        stopStream(callState.screenStream);
    }
});
