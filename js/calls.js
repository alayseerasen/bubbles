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
            autoGainControl: saved.autoGainControl !== false,
            advancedNoiseReduction: saved.advancedNoiseReduction !== false
        };
    } catch (e) {
        return { micId: "", camId: "", speakerId: "", quality: "hd", noiseSuppression: true, echoCancellation: true, autoGainControl: true, advancedNoiseReduction: true };
    }
}

function saveCallSettings() {
    localStorage.setItem("bubbles-call-settings", JSON.stringify(callSettings));
}

let callSettings = loadCallSettings();
let ringChannel = null; // персональный канал "мне звонят", живёт всё время, пока открыт сайт

// status: "idle" | "calling" (я звоню, жду ответа) | "ringing" (мне звонят)
//       | "connected" (собеседник взял трубку)
let callState = {
    status: "idle",
    callId: null,
    remoteUserId: null,
    remoteName: "",
    remoteAvatar: "",
    inviteRowId: null,
    channel: null,
    channelReady: false,   // канал звонка реально подписан (до этого send() уходит в никуда)
    signalQueue: [],       // сигналы, которые некуда было отправить до подписки
    pc: null,
    isCaller: false,
    answered: false,       // собеседник взял трубку (не то же самое, что "мы подписались")
    initialAnswerSent: false, // callee отправил answer на первичный offer
    polite: false,
    makingOffer: false,
    ignoreOffer: false,
    localStream: null,
    screenStream: null,
    camSender: null,       // RTCRtpSender камеры — ищем именно его, а не по label
    screenSender: null,    // RTCRtpSender показа экрана
    micOn: true,
    camOn: false,
    screenOn: false,
    remoteVideoOn: false,
    remoteScreenOn: false,
    remoteCamTrackId: null,    // id дорожек, которые собеседник объявил в "state"
    remoteScreenTrackId: null,
    pendingCandidates: [], // ICE до того, как применён remote description
    connectedAt: null,
    durationTimer: null,
    _connectingTimer: null,
    expanded: false, // big spotlight view vs. the compact floating bar
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
            if (callState.status === "ringing" && callState.callId === payload?.callId) endCallLocally("Звонок отменён.");
        })
        .on("broadcast", { event: "decline" }, ({ payload }) => {
            if (callState.status !== "calling" || callState.callId !== payload?.callId) return;
            endCallLocally(
                payload.reason === "busy" ? "Собеседник сейчас на другом звонке."
                : payload.reason === "timeout" ? "Собеседник не отвечает."
                : "Звонок отклонён."
            );
        })
        .subscribe();
}

function teardownCallSignaling() {
    if (ringChannel) { try { sb.removeChannel(ringChannel); } catch (e) {} ringChannel = null; }
    if (callState.status !== "idle") endCallLocally();
}

// Персональный канал "мне звонят" принадлежит собеседнику, мы в нём не
// подписаны — supabase-js отправит такое сообщение через REST-fallback
// broadcast, этого достаточно для одноразового сигнала.
function sendRingEvent(userId, event, payload) {
    const id = safeId(userId);
    if (!id) return;
    try {
        sb.channel("call-ring-" + id).send({ type: "broadcast", event, payload })
            .catch((e) => console.error("Не удалось отправить сигнал звонка:", event, e));
    } catch (e) { console.error("Не удалось отправить сигнал звонка:", event, e); }
}

function handleIncomingInvite(payload) {
    const callId = safeId(payload?.callId);
    const from = safeId(payload?.from);
    // Битый/поддельный payload (в broadcast может прийти что угодно) не
    // должен ронять ринг-экран и уж тем более подставляться в разметку.
    if (!callId || !from || from === currentUserId) return;

    if (callState.status !== "idle") {
        // Уже на другом звонке — сразу "занято", не мучаем модалкой.
        sendRingEvent(from, "decline", { callId, reason: "busy" });
        return;
    }

    callState.status = "ringing";
    callState.callId = callId;
    callState.remoteUserId = from;
    callState.remoteName = payload.name || "Кто-то";
    callState.remoteAvatar = payload.avatar || "";
    callState.inviteRowId = safeId(payload.inviteRowId) || null;

    playRingtone();
    renderIncomingCallModal();

    callState.ringTimeout = setTimeout(() => {
        if (callState.status !== "ringing") return;
        // Сообщаем звонящему, что трубку не взяли — иначе он висит в
        // "Звоним…" до собственного таймаута.
        sendRingEvent(callState.remoteUserId, "decline", { callId: callState.callId, reason: "timeout" });
        markCallInviteStatus("missed");
        endCallLocally("Пропущенный звонок.");
    }, CALL_RING_TIMEOUT_MS);
}

/* ------------------------------------------------------------
   ИСХОДЯЩИЙ ЗВОНОК
   ------------------------------------------------------------ */

async function startDirectCall(partnerId) {
    if (callState.status !== "idle") { toast("Ты уже на звонке."); return; }

    partnerId = safeId(partnerId);
    if (!partnerId || partnerId === currentUserId) return;

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
    callState.isCaller = true;

    // Важно: статус остаётся "calling" до тех пор, пока собеседник реально
    // не возьмёт трубку (см. handlePeerReady). Раньше здесь сразу
    // выставлялся "connected" — из-за этого таймаут "не отвечает" не
    // срабатывал никогда, кнопка отмены перестала работать (она проверяет
    // status === "calling"), а модалка "Звоним…" висела до перезагрузки.
    joinCallChannel(callId, partnerId, { caller: true });

    // Reaches the callee even if their app isn't open to receive the
    // broadcast below — this insert fires a push notification via a
    // Database Webhook (see supabase/functions/send-push). Fire-and-forget:
    // a call ringing successfully in front of them right now shouldn't be
    // held up by this. inviteRowId rides along in the broadcast payload
    // too, so the CALLEE'S side can also update this same row's status
    // (accept/decline) — they never inserted it themselves.
    const inviteRowId = uid("callinvite");
    callState.inviteRowId = inviteRowId;
    sb.from("call_invites").insert({ id: inviteRowId, call_id: callId, caller_id: currentUserId, callee_id: partnerId })
        .then(({ error }) => { if (error) console.error("call_invites insert failed:", error); });

    sendRingEvent(partnerId, "invite", {
        callId,
        from: currentUserId,
        name: me?.displayName || "Кто-то",
        avatar: me?.avatar || "",
        inviteRowId
    });

    renderOutgoingCallModal();

    callState.ringTimeout = setTimeout(() => {
        if (callState.status !== "calling") return;
        sendRingEvent(partnerId, "cancel", { callId });
        markCallInviteStatus("missed");
        endCallLocally("Абонент не отвечает.");
    }, CALL_RING_TIMEOUT_MS);
}

// Best-effort — the call itself never depends on this succeeding, it's
// just for the push webhook / a future missed-calls list.
function markCallInviteStatus(status) {
    if (!callState.inviteRowId) return;
    sb.from("call_invites").update({ status, resolved_at: new Date().toISOString() }).eq("id", callState.inviteRowId)
        .then(({ error }) => { if (error) console.error("call_invites update failed:", error); });
}

function cancelOutgoingCall() {
    if (callState.status !== "calling") return;
    sendRingEvent(callState.remoteUserId, "cancel", { callId: callState.callId });
    markCallInviteStatus("cancelled");
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
    callState.isCaller = false;
    if (callState.ringTimeout) { clearTimeout(callState.ringTimeout); callState.ringTimeout = null; }
    markCallInviteStatus("answered");

    joinCallChannel(callState.callId, callState.remoteUserId, { caller: false });
}

function declineIncomingCall() {
    if (callState.status !== "ringing") return;
    sendRingEvent(callState.remoteUserId, "decline", { callId: callState.callId });
    markCallInviteStatus("declined");
    stopRingtone();
    closeBubblesModal();
    endCallLocally();
}

/* ------------------------------------------------------------
   КАНАЛ ЗВОНКА (сигналинг + сам WebRTC)
   ------------------------------------------------------------ */

function joinCallChannel(callId, partnerId, { caller = false } = {}) {
    const channel = sb.channel("call:" + callId)
        .on("broadcast", { event: "signal" }, ({ payload }) => {
            if (payload?.to !== currentUserId) return;
            handleSignal(payload.data);
        })
        .on("broadcast", { event: "ready" }, ({ payload }) => {
            if (payload?.from !== callState.remoteUserId) return;
            handlePeerReady();
        })
        .on("broadcast", { event: "state" }, ({ payload }) => {
            if (payload?.from !== callState.remoteUserId) return;
            const remoteScreenJustStarted = !!payload.screen && !callState.remoteScreenOn;
            callState.remoteVideoOn = !!payload.video;
            callState.remoteScreenOn = !!payload.screen;
            // Какой удалённый трек камера, а какой — показ экрана, знает
            // только сам собеседник: у полученного трека label всегда
            // "remote video", а не тот, что мы выставили у себя. Поэтому
            // он присылает id дорожек, а мы по ним раскладываем плитки.
            callState.remoteCamTrackId = safeId(payload.camTrackId) || null;
            callState.remoteScreenTrackId = safeId(payload.screenTrackId) || null;
            // Whoever's screen it is, seeing it shouldn't require squinting
            // at a tiny floating window — auto-expand the moment it starts.
            if (remoteScreenJustStarted) callState.expanded = true;
            renderCallBar();
        })
        .on("broadcast", { event: "hangup" }, ({ payload }) => {
            if (payload?.from !== callState.remoteUserId) return;
            endCallLocally("Собеседник завершил звонок.");
        })
        .subscribe((status, err) => {
            if (status === "SUBSCRIBED") {
                callState.channelReady = true;
                if (caller && !callState.answered) {
                    // Пока мы подписывались, в очередь попал offer, отправленный
                    // в пустоту (трубку ещё не взяли). Он устарел: свежий
                    // уйдёт из handlePeerReady вместе со всеми собранными ICE.
                    callState.signalQueue.length = 0;
                } else {
                    flushQueuedSignals();
                }
                // "Я в комнате". Именно этот сигнал закрывает у звонящего
                // экран "Звоним…" и заставляет его переотправить offer:
                // offer, созданный во время гудков, улетел в пустоту —
                // принимающая сторона ещё не была подписана на канал.
                if (!caller) sendCallEvent("ready", { from: currentUserId });
                broadcastMyState();
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                console.error(`❌ realtime [call] ${status}`, err || "");
            }
        });

    callState.channel = channel;
    callState.isCaller = caller;

    // У звонящего статус остаётся "calling": трубку ещё не взяли, панель
    // звонка показывать рано (висит модалка "Звоним…", её закроет ready).
    if (!caller) {
        callState.status = "connected";
        callState.answered = true;
    }

    setupPeerConnection();

    if (!caller) renderCallBar();
}

// Собеседник взял трубку (пришёл "ready" по каналу звонка).
function handlePeerReady() {
    if (callState.status !== "calling") return;
    if (callState.ringTimeout) { clearTimeout(callState.ringTimeout); callState.ringTimeout = null; }

    callState.answered = true;
    callState.status = "connected";
    closeBubblesModal();
    renderCallBar();

    // Переотправляем свой offer вместе с уже собранными ICE-кандидатами —
    // тот, что уходил во время гудков, до собеседника не дошёл.
    const pc = callState.pc;
    if (pc) {
        // дождаться завершения текущего makingOffer
        const wait = () => new Promise((res) => {
            if (!callState.makingOffer) return res();
            const iv = setInterval(() => { if (!callState.makingOffer) { clearInterval(iv); res(); } }, 50);
            setTimeout(() => { clearInterval(iv); res(); }, 2000);
        });
        wait().then(() => {
            if (pc.signalingState === "have-local-offer" && pc.localDescription?.type === "offer") {
                sendSignal({ description: pc.localDescription });
            } else if (pc.signalingState === "stable") {
                // offer не был создан — создаём сейчас
                callState.makingOffer = true;
                pc.setLocalDescription().then(() => {
                    sendSignal({ description: pc.localDescription });
                }).catch(() => {}).finally(() => { callState.makingOffer = false; });
            }
        });
    }
}

function setupPeerConnection() {
    const pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS });
    callState.pc = pc;

    callState.localStream?.getTracks().forEach(track => {
        const sender = pc.addTrack(track, callState.localStream);
        if (track.kind === "video") applyEncodingBitrate(sender, CALL_QUALITY_PRESETS[callSettings.quality].videoBitrate);
    });

    pc.onnegotiationneeded = async () => {
        // Callee не создаёт offer до того, как ответил на первичный offer
        // звонящего — иначе оба шлют offer и соединение не поднимается.
        if (!callState.isCaller && !callState.initialAnswerSent) return;
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
        if (event.track.kind === "audio") {
            requestAnimationFrame(() => {
                let audioEl = document.getElementById("callRemoteAudio");
                if (!audioEl) { renderCallBar(); audioEl = document.getElementById("callRemoteAudio"); }
                if (!audioEl) return;
                audioEl.srcObject = event.streams[0] || new MediaStream([event.track]);
                if (callSettings.speakerId && audioEl.setSinkId) audioEl.setSinkId(callSettings.speakerId).catch(() => {});
            });
            return;
        }
        // Видео: раскладываем по плиткам после того, как узнаем от
        // собеседника id дорожек (label у входящего трека всегда
        // "remote video", поэтому старый поиск по label не срабатывал).
        requestAnimationFrame(() => attachRemoteVideoTracks());
    };

    let connectedSoundPlayed = false;
    let iceRestartAttempted = false;
    let reconnectFailTimeout = null;

    pc.onconnectionstatechange = () => {
        if (callState.pc !== pc) return;
        const state = pc.connectionState;

        if (state === "connected") {
            if (!connectedSoundPlayed) { connectedSoundPlayed = true; playSound("callConnect"); }
            iceRestartAttempted = false;
            if (reconnectFailTimeout) { clearTimeout(reconnectFailTimeout); reconnectFailTimeout = null; }
            if (callState._connectingTimer) { clearTimeout(callState._connectingTimer); callState._connectingTimer = null; }
            hideReconnectingBanner();
            if (!callState.connectedAt) { callState.connectedAt = Date.now(); startCallTimer(); }
            renderCallBar();
            return;
        }

        if (state === "disconnected") {
            showReconnectingBanner();
        }

        if (state === "failed") {
            showReconnectingBanner();
            if (!iceRestartAttempted) {
                iceRestartAttempted = true;
                attemptIceRestart(pc);
                reconnectFailTimeout = setTimeout(() => {
                    if (callState.pc === pc && pc.connectionState !== "connected") {
                        endCallLocally(callState.status === "connected"
                            ? "Не удалось восстановить связь — звонок завершён."
                            : "Не удалось установить соединение.");
                    }
                }, 8000);
            }
        }

        // Застряли в "connecting"/"new" — пробуем ICE-restart, потом завершаем.
        if (state === "connecting" || state === "new") {
            if (callState._connectingTimer) clearTimeout(callState._connectingTimer);
            callState._connectingTimer = setTimeout(() => {
                if (callState.pc !== pc || pc.connectionState === "connected") return;
                if (!iceRestartAttempted) {
                    iceRestartAttempted = true;
                    attemptIceRestart(pc);
                }
                // Если и после рестарта не поднялось — завершаем звонок.
                callState._connectingTimer = setTimeout(() => {
                    if (callState.pc === pc && pc.connectionState !== "connected") {
                        endCallLocally("Не удалось установить соединение.");
                    }
                }, 15000);
            }, 12000);
        }

        renderCallBar();
    };
}

// Only the offer side actually needs to (and is allowed to) restart
// ICE — asks setupPeerConnection's existing negotiationneeded handler
// to include iceRestart, prompting fresh candidate gathering without
// tearing down the whole RTCPeerConnection or replaying the ring flow.
async function attemptIceRestart(pc) {
    try {
        if (pc.restartIce) { pc.restartIce(); return; }
        // Older browsers without restartIce(): fall back to manually
        // creating a re-offer with iceRestart set.
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        // Раньше здесь уходило { type: "offer", sdp }, а приёмник умеет
        // только { description } / { candidate } — то есть этот
        // fallback-путь не работал вообще.
        sendSignal({ description: pc.localDescription });
    } catch (e) {
        console.error("ICE restart failed:", e);
    }
}

function showReconnectingBanner() {
    const bar = document.getElementById("callBar");
    if (bar && !bar.querySelector(".call-reconnecting-badge")) {
        bar.insertAdjacentHTML("afterbegin", `<div class="call-reconnecting-badge">🔄 Восстанавливаем связь…</div>`);
    }
}

function hideReconnectingBanner() {
    document.querySelector(".call-reconnecting-badge")?.remove();
}

function sendCallEvent(event, payload) {
    if (!callState.channel) return;
    try {
        callState.channel.send({ type: "broadcast", event, payload })
            .catch((e) => console.error(`Не удалось отправить "${event}" в звонке:`, e));
    } catch (e) { console.error(`Не удалось отправить "${event}" в звонке:`, e); }
}

// Сигналинг до того, как канал подписан, раньше просто терялся: channel.send()
// в этот момент уходит в REST-fallback и разлетается в пустоту (собеседник
// ещё не в канале). Теперь такие сигналы ждут в очереди и уходят сразу
// после SUBSCRIBED.
function sendSignal(data) {
    if (!callState.channel) return;
    if (!callState.channelReady) {
        callState.signalQueue.push(data);
        if (callState.signalQueue.length > 200) callState.signalQueue.shift();
        return;
    }
    sendCallEvent("signal", { to: callState.remoteUserId, from: currentUserId, data });
}

function flushQueuedSignals() {
    const queued = callState.signalQueue.splice(0);
    queued.forEach((data) => sendCallEvent("signal", { to: callState.remoteUserId, from: currentUserId, data }));
}

function flushPendingCandidates() {
    const pc = callState.pc;
    if (!pc || !pc.remoteDescription) return;
    const queued = callState.pendingCandidates.splice(0);
    queued.forEach((candidate) => {
        pc.addIceCandidate(candidate).catch(() => { /* кандидат от отклонённого offer — уже неактуален */ });
    });
}

async function handleSignal(data) {
    const pc = callState.pc;
    if (!pc || !data) return;
    try {
        if (data.description) {
            const offerCollision = data.description.type === "offer" && (callState.makingOffer || pc.signalingState !== "stable");
            callState.ignoreOffer = !callState.polite && offerCollision;
            if (callState.ignoreOffer) return;

            // Polite peer при коллизии откатывает свой pending offer,
            // иначе setRemoteDescription бросает InvalidStateError.
            if (offerCollision && callState.polite && pc.signalingState === "have-local-offer") {
                try { await pc.setLocalDescription({ type: "rollback" }); } catch (e) { /* ignore */ }
            }

            let desc = data.description;
            if ((desc.type === "offer" || desc.type === "answer") && desc.sdp && desc.sdp.includes("m=audio")) {
                desc = { ...desc, sdp: boostOpusBitrate(desc.sdp) };
            }
            await pc.setRemoteDescription(desc);
            flushPendingCandidates();
            if (data.description.type === "offer") {
                await pc.setLocalDescription();
                callState.initialAnswerSent = true;
                sendSignal({ description: pc.localDescription });
            }
        } else if (data.candidate) {
            // Кандидаты прилетают быстрее, чем применяется offer/answer.
            // addIceCandidate до setRemoteDescription бросает исключение —
            // раньше такие кандидаты просто пропадали, и звонок мог
            // "соединиться" без звука.
            if (!pc.remoteDescription) { callState.pendingCandidates.push(data.candidate); return; }
            try { await pc.addIceCandidate(data.candidate); }
            catch (e) { if (!callState.ignoreOffer) console.error(e); }
        }
    } catch (e) {
        console.error("Ошибка сигналинга звонка:", e);
    }
}

function broadcastMyState() {
    if (!callState.channel || !callState.channelReady) return;
    const camTrack = callState.localStream?.getVideoTracks()[0] || null;
    const screenTrack = callState.screenStream?.getVideoTracks()[0] || null;
    sendCallEvent("state", {
        from: currentUserId,
        video: !!(callState.camOn && camTrack),
        screen: !!(callState.screenOn && screenTrack),
        camTrackId: camTrack?.id || null,
        screenTrackId: screenTrack?.id || null
    });
}

/* ------------------------------------------------------------
   ЗАВЕРШЕНИЕ ЗВОНКА
   ------------------------------------------------------------ */

function hangUpCall() {
    if (callState.status === "calling") { cancelOutgoingCall(); return; }
    if (callState.status === "ringing") { declineIncomingCall(); return; }
    sendCallEvent("hangup", { from: currentUserId });
    endCallLocally();
}

function endCallLocally(toastMessage) {
    if (callState.ringTimeout) { clearTimeout(callState.ringTimeout); callState.ringTimeout = null; }
    if (callState._connectingTimer) { clearTimeout(callState._connectingTimer); callState._connectingTimer = null; }
    stopCallTimer();
    stopRingtone();
    try { closeBubblesModal(); } catch (e) {}
    if (callState.status !== "idle") playSound("callEnd");

    try { callState.pc?.close(); } catch (e) {}
    stopMicStream(callState.localStream);
    stopStream(callState.screenStream);
    if (callState.channel) { try { sb.removeChannel(callState.channel); } catch (e) {} }

    const wasStatus = callState.status;
    callState = {
        status: "idle", callId: null, remoteUserId: null, remoteName: "", remoteAvatar: "", inviteRowId: null,
        channel: null, channelReady: false, signalQueue: [], pc: null, isCaller: false, answered: false,
        polite: false, makingOffer: false, ignoreOffer: false,
        localStream: null, screenStream: null, camSender: null, screenSender: null,
        micOn: true, camOn: false, screenOn: false,
        remoteVideoOn: false, remoteScreenOn: false, remoteCamTrackId: null, remoteScreenTrackId: null,
        pendingCandidates: [], connectedAt: null, durationTimer: null, _connectingTimer: null,
        expanded: false, ringTimeout: null, stopRingtone: null
    };

    renderCallBar();
    if (toastMessage && wasStatus !== "idle") toast(toastMessage);
}

/* ------------------------------------------------------------
   ТАЙМЕР РАЗГОВОРА
   ------------------------------------------------------------ */

function startCallTimer() {
    if (callState.durationTimer) return;
    callState.durationTimer = setInterval(updateCallTimerLabel, 1000);
    updateCallTimerLabel();
}

function stopCallTimer() {
    if (callState.durationTimer) { clearInterval(callState.durationTimer); callState.durationTimer = null; }
}

function updateCallTimerLabel() {
    const el = document.getElementById("callBarTimer");
    if (el) el.textContent = formatCallTimer();
}

function formatCallTimer() {
    if (!callState.connectedAt) return "соединение…";
    const total = Math.max(0, Math.floor((Date.now() - callState.connectedAt) / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------
   УДАЛЁННОЕ ВИДЕО — какая дорожка куда
   ------------------------------------------------------------
   У полученного трека label всегда "remote video", поэтому старый
   код (искавший label === "screen") никогда не узнавал показ экрана
   и складывал оба видео в плитку камеры. Вместо этого собеседник
   присылает в "state" id своих дорожек — по ним и раскладываем.
   ------------------------------------------------------------ */

function remoteVideoTracks() {
    const tracks = (callState.pc?.getReceivers() || [])
        .map(r => r.track)
        .filter(t => t && t.kind === "video");

    const byId = (id) => (id ? tracks.find(t => t.id === id) || null : null);
    let cam = byId(callState.remoteCamTrackId);
    let screen = byId(callState.remoteScreenTrackId);

    // Пока "state" не дошёл: первое видео — камера, второе — показ экрана.
    if (!cam) cam = tracks.find(t => t !== screen) || null;
    if (!screen && tracks.length > 1) screen = tracks.find(t => t !== cam) || null;
    return { cam, screen };
}

function attachRemoteVideoTracks() {
    const { cam, screen } = remoteVideoTracks();

    const camEl = document.getElementById("callTile-cam-remote");
    if (camEl && cam && camEl.srcObject?.getVideoTracks?.()[0] !== cam) {
        camEl.srcObject = new MediaStream([cam]);
    }
    const screenEl = document.getElementById("callTile-screen-remote");
    if (screenEl && screen && screenEl.srcObject?.getVideoTracks?.()[0] !== screen) {
        screenEl.srcObject = new MediaStream([screen]);
    }
}

function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
}

// Releasing a mic stream returned by getMicStream() needs to release more
// than just its (possibly Web-Audio-processed) track: also the raw
// hardware capture feeding it and the AudioContext doing the processing,
// or the mic indicator light stays on and the AudioContext leaks.
function stopMicStream(stream) {
    if (!stream) return;
    stopStream(stream);
    if (stream._rawMicStream) stopStream(stream._rawMicStream);
    if (stream._micAudioContext) { try { stream._micAudioContext.close(); } catch (e) {} }
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
            sampleRate: 48000,
            // Chrome-specific legacy constraints layered on top of the
            // standard ones above, for extra suppression where the browser
            // supports it — other browsers silently ignore unknown keys.
            googEchoCancellation: callSettings.echoCancellation,
            googNoiseSuppression: callSettings.noiseSuppression,
            googNoiseSuppression2: callSettings.noiseSuppression,
            googAutoGainControl: callSettings.autoGainControl,
            googAutoGainControl2: callSettings.autoGainControl,
            googHighpassFilter: true,
            googTypingNoiseDetection: true
        },
        video: false
    }).then(rawStream => {
        const processed = callSettings.advancedNoiseReduction ? buildProcessedMicStream(rawStream) : null;
        if (!processed) return rawStream;
        // Tag the stream we actually hand back with what it needs for full
        // cleanup later (see stopMicStream) — the raw hardware capture and
        // the AudioContext doing the processing don't stop just because
        // the processed track does.
        processed.stream._rawMicStream = rawStream;
        processed.stream._micAudioContext = processed.audioContext;
        return processed.stream;
    });
}

// Runs the raw mic capture through a small Web Audio processing chain
// before it ever reaches WebRTC — a real improvement on top of (not a
// replacement for) the browser's own echoCancellation/noiseSuppression
// constraints, which only do so much on their own:
//   1) a highpass filter removes low-frequency rumble (AC hum, desk
//      vibration, wind on a mic) well below where speech lives;
//   2) a narrow peaking cut around 120Hz tames mains-hum bleed that's
//      common on cheap mics/interfaces;
//   3) a gentle compressor evens out levels and pulls quiet, steady
//      background noise further beneath voice peaks, so speech reads
//      as relatively louder without hard-gating anything.
// This is standard DSP, not ML-based denoising (e.g. RNNoise) — it won't
// remove a barking dog, but it measurably cleans up the common cases
// (hum, rumble, room tone) on top of what the browser already does.
function buildProcessedMicStream(rawStream) {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass || !rawStream.getAudioTracks().length) return null;

        const audioContext = new AudioContextClass();
        const source = audioContext.createMediaStreamSource(rawStream);

        const highpass = audioContext.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 90;
        highpass.Q.value = 0.7;

        const humNotch = audioContext.createBiquadFilter();
        humNotch.type = "peaking";
        humNotch.frequency.value = 120;
        humNotch.Q.value = 6;
        humNotch.gain.value = -8;

        const compressor = audioContext.createDynamicsCompressor();
        compressor.threshold.value = -50;
        compressor.knee.value = 12;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        const destination = audioContext.createMediaStreamDestination();
        source.connect(highpass);
        highpass.connect(humNotch);
        humNotch.connect(compressor);
        compressor.connect(destination);

        return { stream: destination.stream, audioContext };
    } catch (e) {
        console.error("Не удалось включить улучшенное шумоподавление:", e);
        return null;
    }
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
        if (callState.camSender) { try { callState.pc.removeTrack(callState.camSender); } catch (e) {} }
        callState.camSender = null;
        callState.camOn = false;
    } else {
        try {
            const camStream = await getCamStream();
            const track = camStream.getVideoTracks()[0];
            callState.localStream.addTrack(track);
            const sender = callState.pc.addTrack(track, callState.localStream);
            applyEncodingBitrate(sender, CALL_QUALITY_PRESETS[callSettings.quality].videoBitrate);
            callState.camSender = sender;
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
        if (callState.screenSender) { try { callState.pc.removeTrack(callState.screenSender); } catch (e) {} }
        callState.screenSender = null;
        callState.screenOn = false;
    } else {
        try {
            const q = CALL_QUALITY_PRESETS[callSettings.quality] || CALL_QUALITY_PRESETS.hd;
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: q.frameRate }, width: { ideal: q.width }, height: { ideal: q.height } },
                audio: false
            });
            const track = stream.getVideoTracks()[0];
            track.onended = () => { if (callState.screenOn) toggleScreenShare(); };
            callState.screenStream = stream;
            const sender = callState.pc.addTrack(track, stream);
            applyEncodingBitrate(sender, q.screenBitrate);
            callState.screenSender = sender;
            callState.screenOn = true;
            // A shared screen is the whole point — don't make anyone
            // squint at a 420px floating window to read it.
            callState.expanded = true;
        } catch (e) {
            console.error(e);
            if (e.name !== "NotAllowedError") toast("Не удалось начать показ экрана.");
            return;
        }
    }
    broadcastMyState();
    renderCallBar();
}

function toggleCallExpanded() {
    callState.expanded = !callState.expanded;
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
            <img class="call-modal-avatar call-modal-avatar-pulse" src="${safeImageUrl(callState.remoteAvatar) || defaultAvatar()}">
            <h3>${escapeHtml(callState.remoteName)}</h3>
            <p class="muted">Входящий звонок…</p>
            <div class="call-modal-actions">
                <button class="call-btn call-btn-accept" onclick="acceptIncomingCall()" title="Принять">📞</button>
                <button class="call-btn call-btn-off" onclick="declineIncomingCall()" title="Отклонить">✕</button>
            </div>
        </div>
    `);
    // Клик мимо модалки по умолчанию просто закрывает её — а звонок при
    // этом оставался бы "висеть" (рингтон играет, а принять/отклонить
    // уже нечем, до истечения 45-секундного таймаута). Мимо — тоже отказ.
    overrideModalBackdropClick(declineIncomingCall);
}

function renderOutgoingCallModal() {
    showBubblesModal(`
        <div class="call-modal">
            <img class="call-modal-avatar call-modal-avatar-pulse" src="${safeImageUrl(callState.remoteAvatar) || defaultAvatar()}">
            <h3>${escapeHtml(callState.remoteName)}</h3>
            <p class="muted">Звоним…</p>
            <div class="call-modal-actions">
                <button class="call-btn call-btn-off" onclick="cancelOutgoingCall()" title="Отменить">✕</button>
            </div>
        </div>
    `);
    overrideModalBackdropClick(cancelOutgoingCall);
}

// showBubblesModal's backdrop always just closes the overlay — fine for
// plain info modals, but wrong for anything with pending async state (a
// ringing call, a crop-in-progress) where dismissing the overlay without
// running the matching cancel/decline leaves that state stuck. Swaps the
// backdrop's click handler to run `fn` (which is expected to close the
// modal itself as part of cleaning up) instead of the default.
function overrideModalBackdropClick(fn) {
    const overlay = document.getElementById("bubblesModalOverlay");
    if (overlay) overlay.onclick = (e) => { if (e.target === overlay) fn(); };
}

/* ------------------------------------------------------------
   ПАНЕЛЬ АКТИВНОГО ЗВОНКА
   ------------------------------------------------------------
   Раньше вся панель (включая <audio> с потоком собеседника)
   пересобиралась через innerHTML на КАЖДЫЙ чих — даже просто на
   mute микрофона. У video/audio-элементов это не косметика: новый
   <audio> ничего не транслирует, пока туда заново не подставят
   srcObject, а pc.ontrack стреляет только один раз на трек — то
   есть звук собеседника мог пропасть насовсем после первого же
   переключения кнопки во время звонка. Плюс лишнее мигание
   видео-плиток. Поэтому теперь: аудио-элемент и структура панели
   создаются один раз и переиспользуются, а плитки с видео
   перерисовываются только когда реально меняется их состав.
   ------------------------------------------------------------ */

let lastCallTileSignature = null;

function renderCallBar() {
    const bar = document.getElementById("callBar");
    if (!bar) return;

    if (callState.status !== "connected") {
        bar.classList.add("hidden");
        bar.classList.remove("expanded");
        bar.innerHTML = "";
        lastCallTileSignature = null;
        return;
    }

    bar.classList.remove("hidden");

    let audioEl = document.getElementById("callRemoteAudio");
    let topEl = document.getElementById("callBarTop");
    let tilesEl = document.getElementById("callBarTiles");
    let controlsEl = document.getElementById("callBarControls");
    if (!audioEl || !topEl || !tilesEl || !controlsEl) {
        bar.innerHTML = `
            <audio id="callRemoteAudio" autoplay></audio>
            <div class="call-bar-top" id="callBarTop"></div>
            <div id="callBarTiles"></div>
            <div class="call-bar-controls" id="callBarControls"></div>
        `;
        audioEl = document.getElementById("callRemoteAudio");
        topEl = document.getElementById("callBarTop");
        tilesEl = document.getElementById("callBarTiles");
        controlsEl = document.getElementById("callBarControls");
        lastCallTileSignature = null; // контейнер новый — плитки точно нужно нарисовать
    }

    // Build each possible tile's definition once — screen shares first,
    // since that's almost always what people actually want to look at.
    const tileDefs = [];
    if (callState.remoteScreenOn) tileDefs.push({ id: "callTile-screen-remote", label: `🖥️ ${escapeHtml(callState.remoteName)}`, screen: true });
    if (callState.screenOn) tileDefs.push({ id: "callTile-screen-me", label: "🖥️ Ты (экран)", screen: true, muted: true });
    if (callState.remoteVideoOn) tileDefs.push({ id: "callTile-cam-remote", label: escapeHtml(callState.remoteName), screen: false });
    if (callState.camOn) tileDefs.push({ id: "callTile-cam-me", label: "Ты", screen: false, muted: true });

    const expanded = callState.expanded && tileDefs.length > 0;
    bar.classList.toggle("expanded", expanded);

    topEl.innerHTML = `
        <div class="call-bar-title">📞 ${escapeHtml(callState.remoteName)}<span id="callBarTimer" class="call-bar-timer">${formatCallTimer()}</span></div>
        ${tileDefs.length ? `<button class="call-btn call-btn-expand" onclick="toggleCallExpanded()" title="${expanded ? "Свернуть" : "Развернуть на весь экран"}">${expanded ? "⤡" : "⤢"}</button>` : ""}
        <button class="call-btn call-btn-leave" onclick="hangUpCall()" title="Завершить">✕</button>
    `;

    controlsEl.innerHTML = `
        <button class="call-btn ${callState.micOn ? "" : "call-btn-off"}" onclick="toggleMic()" title="${callState.micOn ? "Выключить микрофон" : "Включить микрофон"}">${callState.micOn ? "🎙️" : "🔇"}</button>
        <button class="call-btn ${callState.camOn ? "call-btn-on" : ""}" onclick="toggleCam()" title="${callState.camOn ? "Выключить камеру" : "Включить камеру"}">🎥</button>
        <button class="call-btn ${callState.screenOn ? "call-btn-on" : ""}" onclick="toggleScreenShare()" title="${callState.screenOn ? "Остановить показ экрана" : "Показать экран"}">🖥️</button>
        <button class="call-btn" onclick="openCallSettings()" title="Настройки звонка">⚙️</button>
    `;

    // Плитки (и их <video>) перерисовываем только когда реально
    // поменялся их состав/раскладка — иначе трогать их незачем, и
    // ничего не мигает при простом mute/settings-клике.
    const signature = JSON.stringify({
        ids: tileDefs.map(t => t.id),
        expanded,
        camId: callState.remoteCamTrackId,
        screenId: callState.remoteScreenTrackId
    });
    const tilesChanged = signature !== lastCallTileSignature;
    if (tilesChanged) {
        lastCallTileSignature = signature;

        const tileHtml = (t, primary) => `
            <div class="call-tile ${t.screen ? "call-tile-screen" : ""} ${primary ? "call-tile-primary" : ""}">
                <video id="${t.id}" autoplay playsinline ${t.muted ? "muted" : ""}></video>
                <div class="call-tile-label">${t.label}</div>
            </div>
        `;

        if (!tileDefs.length) {
            tilesEl.innerHTML = `<p class="muted call-bar-audio-only">Только голос</p>`;
        } else if (expanded) {
            const [primary, ...rest] = tileDefs;
            tilesEl.innerHTML = `
                <div class="call-spotlight">
                    ${tileHtml(primary, true)}
                    ${rest.length ? `<div class="call-spotlight-thumbs">${rest.map(t => tileHtml(t, false)).join("")}</div>` : ""}
                </div>
            `;
        } else {
            tilesEl.innerHTML = `<div class="call-tiles">${tileDefs.map(t => tileHtml(t, false)).join("")}</div>`;
        }
    }

    requestAnimationFrame(() => {
        if (callState.camOn) { const v = document.getElementById("callTile-cam-me"); if (v) v.srcObject = callState.localStream; }
        if (callState.screenOn) { const v = document.getElementById("callTile-screen-me"); if (v) v.srcObject = callState.screenStream; }
        // Пересвязываем удалённые потоки только если плитки только что
        // пересозданы — иначе уже подключённые <video>/<audio> трогать не надо.
        if (tilesChanged) attachRemoteVideoTracks();
        // Аудио-элемент теперь живёт всю длительность звонка — если он
        // почему-то ещё пуст (например, поменяли настройки раньше, чем
        // прилетел трек), подключаем поток из ресивера как подстраховку.
        if (audioEl && !audioEl.srcObject) {
            const audioReceiver = callState.pc?.getReceivers().find(r => r.track && r.track.kind === "audio");
            if (audioReceiver) audioEl.srcObject = new MediaStream([audioReceiver.track]);
        }
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
        if (!callState.localStream) await getMicStream().then(s => stopMicStream(s));
        devices = await navigator.mediaDevices.enumerateDevices();
    } catch (e) { console.error(e); }

    const mics = devices.filter(d => d.kind === "audioinput");
    const cams = devices.filter(d => d.kind === "videoinput");
    const speakers = devices.filter(d => d.kind === "audiooutput");

    showBubblesModal(callSettingsModalHtml(mics, cams, speakers));
}

function callSettingsModalHtml(mics, cams, speakers) {
    return `
        <div class="modal-header">
            <h3>Настройки звонка</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>

        ${callSettingsFieldsHtml(mics, cams, speakers, "callSetting", "applyCallSettingsFromModal()")}

        <p class="muted" style="margin-top:10px;">Смена микрофона/камеры применится сразу, если звонок уже идёт. Качество видео — при следующем включении камеры или показа экрана.</p>
    `;
}

// Shared by the in-call settings modal and the standalone "📞 Звонки"
// card on the main Settings page, so both stay in sync and there's one
// place that defines what a device/quality/audio-processing picker
// looks like. idPrefix keeps element ids from colliding if both were
// ever on screen at once; onChangeCall is the function name to invoke
// on every change. `compact` collapses the four individual audio
// checkboxes behind one "Улучшить качество" master toggle + a
// "Расширенные настройки" disclosure — used on the standalone Settings
// page, where four separate checkboxes (echo/noise/AGC/advanced) is a
// lot to make sense of on a casual visit. The in-call modal keeps them
// all visible directly (compact=false), since mid-call troubleshooting
// benefits from getting straight to the specific knob that's wrong.
function callSettingsFieldsHtml(mics, cams, speakers, idPrefix, onChangeCall, compact = false) {
    const opt = (list, selected, fallbackLabel) => list.map((d, i) =>
        `<option value="${d.deviceId}" ${d.deviceId === selected ? "selected" : ""}>${escapeHtml(d.label || `${fallbackLabel} ${i + 1}`)}</option>`
    ).join("");

    const allBoosted = callSettings.echoCancellation && callSettings.noiseSuppression && callSettings.autoGainControl && callSettings.advancedNoiseReduction;

    const toggles = `
        <label><input type="checkbox" id="${idPrefix}Echo" ${callSettings.echoCancellation ? "checked" : ""} onchange="${onChangeCall}"> Подавление эха</label>
        <label><input type="checkbox" id="${idPrefix}Noise" ${callSettings.noiseSuppression ? "checked" : ""} onchange="${onChangeCall}"> Шумоподавление (браузер)</label>
        <label><input type="checkbox" id="${idPrefix}Agc" ${callSettings.autoGainControl ? "checked" : ""} onchange="${onChangeCall}"> Автогромкость микрофона</label>
        <label><input type="checkbox" id="${idPrefix}Advanced" ${callSettings.advancedNoiseReduction ? "checked" : ""} onchange="${onChangeCall}"> Улучшенное шумоподавление (фильтр гула + компрессор)</label>
    `;

    return `
        <label class="call-settings-label">Микрофон</label>
        <select id="${idPrefix}Mic" onchange="${onChangeCall}">
            <option value="">По умолчанию</option>
            ${opt(mics, callSettings.micId, "Микрофон")}
        </select>

        <label class="call-settings-label">Камера</label>
        <select id="${idPrefix}Cam" onchange="${onChangeCall}">
            <option value="">По умолчанию</option>
            ${opt(cams, callSettings.camId, "Камера")}
        </select>

        ${speakers.length ? `
        <label class="call-settings-label">Динамик</label>
        <select id="${idPrefix}Speaker" onchange="${onChangeCall}">
            <option value="">По умолчанию</option>
            ${opt(speakers, callSettings.speakerId, "Динамик")}
        </select>
        ` : ""}

        <label class="call-settings-label">Качество видео</label>
        <select id="${idPrefix}Quality" onchange="${onChangeCall}">
            ${Object.entries(CALL_QUALITY_PRESETS).map(([key, p]) => `<option value="${key}" ${key === callSettings.quality ? "selected" : ""}>${p.label}</option>`).join("")}
        </select>

        ${
            compact
            ? `
                <label class="call-settings-boost-toggle">
                    <input type="checkbox" id="${idPrefix}Boost" ${allBoosted ? "checked" : ""} onchange="toggleCallQualityBoost('${idPrefix}', this.checked); ${onChangeCall}">
                    🔊 Улучшить качество звука
                </label>
                <details class="call-settings-advanced">
                    <summary>Расширенные настройки звука</summary>
                    <div class="call-settings-toggles">${toggles}</div>
                </details>
              `
            : `<div class="call-settings-toggles">${toggles}</div>`
        }
    `;
}

// The single master toggle on the compact (Settings-page) view just
// flips all four granular checkboxes together — if someone opens the
// advanced disclosure afterward, it reflects the same on/off state
// rather than looking out of sync with what the master toggle showed.
function toggleCallQualityBoost(idPrefix, on) {
    ["Echo", "Noise", "Agc", "Advanced"].forEach(suffix => {
        const el = document.getElementById(`${idPrefix}${suffix}`);
        if (el) el.checked = on;
    });
}

function renderCallSettingsModalIfOpen() {
    if (callSettingsModalOpen && document.getElementById("bubblesModalOverlay")) openCallSettings();
}

async function applyCallSettingsFromModal() {
    await applyCallSettingsFrom("callSetting");
}

// Reads the fields rendered by callSettingsFieldsHtml() under the given
// id prefix, saves them, and — if a call is currently connected — hot
// swaps whatever actually changed (mic/cam device or any audio-processing
// toggle affecting the mic capture) so changes made from the standalone
// Settings page apply live too, exactly like the in-call modal.
async function applyCallSettingsFrom(idPrefix) {
    const micSel = document.getElementById(idPrefix + "Mic");
    const camSel = document.getElementById(idPrefix + "Cam");
    const spkSel = document.getElementById(idPrefix + "Speaker");
    const qSel = document.getElementById(idPrefix + "Quality");
    const echoEl = document.getElementById(idPrefix + "Echo");
    const noiseEl = document.getElementById(idPrefix + "Noise");
    const agcEl = document.getElementById(idPrefix + "Agc");
    const advEl = document.getElementById(idPrefix + "Advanced");

    const micChanged = micSel && micSel.value !== callSettings.micId;
    const camChanged = camSel && camSel.value !== callSettings.camId;
    const audioProcessingChanged =
        (echoEl && echoEl.checked !== callSettings.echoCancellation) ||
        (noiseEl && noiseEl.checked !== callSettings.noiseSuppression) ||
        (agcEl && agcEl.checked !== callSettings.autoGainControl) ||
        (advEl && advEl.checked !== callSettings.advancedNoiseReduction);

    callSettings.micId = micSel ? micSel.value : callSettings.micId;
    callSettings.camId = camSel ? camSel.value : callSettings.camId;
    callSettings.speakerId = spkSel ? spkSel.value : callSettings.speakerId;
    callSettings.quality = qSel ? qSel.value : callSettings.quality;
    callSettings.echoCancellation = echoEl?.checked ?? callSettings.echoCancellation;
    callSettings.noiseSuppression = noiseEl?.checked ?? callSettings.noiseSuppression;
    callSettings.autoGainControl = agcEl?.checked ?? callSettings.autoGainControl;
    callSettings.advancedNoiseReduction = advEl?.checked ?? callSettings.advancedNoiseReduction;
    saveCallSettings();

    if (callState.status === "connected" && (micChanged || audioProcessingChanged)) await swapMicDevice();
    if (callState.status === "connected" && callState.camOn && camChanged) await swapCamDevice();
    if (callState.status === "connected") applyOutputDeviceToAudioEl();

    // If a mic test was running in the standalone settings page, restart
    // it (not toggle it off) so the meter reflects whatever just changed.
    if (callSettingsPreview.micStream) {
        stopMicMeter();
        stopMicStream(callSettingsPreview.micStream);
        callSettingsPreview.micStream = null;
        await testCallMic();
    }
}

async function swapMicDevice() {
    try {
        const newStream = await getMicStream();
        const newTrack = newStream.getAudioTracks()[0];
        newTrack.enabled = callState.micOn;

        const oldTrack = callState.localStream.getAudioTracks()[0];
        const oldRawStream = callState.localStream._rawMicStream;
        const oldAudioContext = callState.localStream._micAudioContext;

        if (oldTrack) { callState.localStream.removeTrack(oldTrack); oldTrack.stop(); }
        callState.localStream.addTrack(newTrack);

        // callState.localStream is the same object for the life of the
        // call (video tracks get added onto it too) — carry the new
        // processing chain's cleanup handles onto it, and release the old
        // chain now that nothing references it anymore.
        callState.localStream._rawMicStream = newStream._rawMicStream;
        callState.localStream._micAudioContext = newStream._micAudioContext;
        if (oldRawStream) stopStream(oldRawStream);
        if (oldAudioContext) { try { oldAudioContext.close(); } catch (e) {} }

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
        const sender = callState.camSender
            || callState.pc.getSenders().find(s => s.track && s.track.kind === "video" && s.track.label !== "screen");
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

/* ------------------------------------------------------------
   НАСТРОЙКИ ЗВОНКОВ НА СТРАНИЦЕ "⚙️ Настройки" (вне звонка)
   ------------------------------------------------------------
   Раньше настройки микрофона/камеры/качества были доступны только
   изнутри активного звонка — то есть нельзя было ни на что повлиять,
   пока кому-то не позвонишь. Этот блок встраивается прямо в общую
   страницу настроек и даёт то же самое в любой момент, плюс
   живой тест микрофона (шкала уровня) и превью камеры, чтобы
   реально было видно, что настройки на что-то влияют — камера/микро-
   фон включаются только по явному нажатию "Проверить", не сами по
   себе при открытии страницы. */

let callSettingsPreview = { micStream: null, camStream: null, meterRaf: null };

async function renderCallSettingsPageSection() {
    let devices = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); }
    catch (e) { console.error(e); }

    const mics = devices.filter(d => d.kind === "audioinput");
    const cams = devices.filter(d => d.kind === "videoinput");
    const speakers = devices.filter(d => d.kind === "audiooutput");
    const labelsHidden = mics.length && mics.every(d => !d.label);

    return `
        <div class="card" style="margin-bottom:16px;">
            <strong>📞 Звонки</strong>
            <p class="muted" style="margin:6px 0 10px;">Настрой микрофон, камеру и качество заранее — не обязательно ждать звонка.</p>

            ${labelsHidden ? `
                <button class="secondary" type="button" onclick="requestCallDeviceAccessAndRefresh()" style="margin-bottom:12px;">
                    🔓 Разрешить доступ и показать названия устройств
                </button>
            ` : ""}

            ${callSettingsFieldsHtml(mics, cams, speakers, "pageCallSetting", "applyCallSettingsFromPage()", true)}

            <div class="call-settings-test-row">
                <button id="pageCallMicTestBtn" class="secondary" type="button" onclick="testCallMic()">🎤 Проверить микрофон</button>
                <button id="pageCallCamTestBtn" class="secondary" type="button" onclick="testCallCam()">🎥 Проверить камеру</button>
            </div>

            <div id="pageCallMicMeterWrap" class="call-mic-meter-wrap hidden">
                <div class="call-mic-meter"><div id="pageCallMicMeterFill" class="call-mic-meter-fill"></div></div>
                <span class="muted" style="font-size:12px;">Говори — полоска должна реагировать на голос и меньше на фон.</span>
            </div>

            <video id="pageCallCamPreview" class="call-cam-preview hidden" autoplay playsinline muted></video>

            <p class="muted" style="margin-top:10px;">Эти настройки используются во всех звонках. Проверка микрофона/камеры включает их только пока открыта эта страница или пока не нажата "Стоп".</p>
        </div>
    `;
}

async function requestCallDeviceAccessAndRefresh() {
    try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stopStream(s);
    } catch (e) {
        console.error(e);
        toast("Нет доступа к микрофону/камере — проверь разрешения браузера.");
    }
    if (currentPage === "edit") renderEditProfile();
}

async function applyCallSettingsFromPage() {
    await applyCallSettingsFrom("pageCallSetting");
}

async function testCallMic() {
    stopMicMeter();
    if (callSettingsPreview.micStream) { stopMicStream(callSettingsPreview.micStream); callSettingsPreview.micStream = null; setMicTestButtonState(false); return; }

    try {
        const stream = await getMicStream();
        callSettingsPreview.micStream = stream;
        setMicTestButtonState(true);
        startMicMeter(stream);
    } catch (e) {
        console.error(e);
        toast("Не удалось получить доступ к микрофону.");
    }
}

function setMicTestButtonState(active) {
    const btn = document.getElementById("pageCallMicTestBtn");
    if (btn) btn.textContent = active ? "⏹️ Остановить" : "🎤 Проверить микрофон";
    const wrap = document.getElementById("pageCallMicMeterWrap");
    if (wrap) wrap.classList.toggle("hidden", !active);
}

// A live input-level meter isn't just eye candy here — it's the one way
// to actually *see* the noise-reduction settings doing something: toggle
// "Улучшенное шумоподавление" while talking near a fan/AC and the bar
// should sit lower on background noise, still jump on your voice.
function startMicMeter(stream) {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextClass();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        stream._meterAudioContext = audioContext; // separate from _micAudioContext — this one's just for the meter

        const tick = () => {
            analyser.getByteTimeDomainData(data);
            let sumSquares = 0;
            for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sumSquares += v * v; }
            const rms = Math.sqrt(sumSquares / data.length);
            const pct = Math.min(100, Math.round(rms * 350));
            const fill = document.getElementById("pageCallMicMeterFill");
            if (fill) fill.style.width = pct + "%";
            callSettingsPreview.meterRaf = requestAnimationFrame(tick);
        };
        tick();
    } catch (e) { console.error(e); }
}

function stopMicMeter() {
    if (callSettingsPreview.meterRaf) { cancelAnimationFrame(callSettingsPreview.meterRaf); callSettingsPreview.meterRaf = null; }
    if (callSettingsPreview.micStream?._meterAudioContext) { try { callSettingsPreview.micStream._meterAudioContext.close(); } catch (e) {} }
}

async function testCallCam() {
    const video = document.getElementById("pageCallCamPreview");
    if (callSettingsPreview.camStream) {
        stopStream(callSettingsPreview.camStream);
        callSettingsPreview.camStream = null;
        if (video) video.classList.add("hidden");
        setCamTestButtonState(false);
        return;
    }
    try {
        const stream = await getCamStream();
        callSettingsPreview.camStream = stream;
        setCamTestButtonState(true);
        if (video) { video.srcObject = stream; video.classList.remove("hidden"); }
    } catch (e) {
        console.error(e);
        toast("Не удалось получить доступ к камере.");
    }
}

function setCamTestButtonState(active) {
    const btn = document.getElementById("pageCallCamTestBtn");
    if (btn) btn.textContent = active ? "⏹️ Остановить" : "🎥 Проверить камеру";
}

// Releases any preview mic/camera started from the Settings page. Called
// on navigating away from it (see navigate() in app.js) and on unload —
// nothing here should keep the mic/camera indicator lit in the
// background once you've left the page.
function stopCallSettingsPreview() {
    stopMicMeter();
    if (callSettingsPreview.micStream) stopMicStream(callSettingsPreview.micStream);
    if (callSettingsPreview.camStream) stopStream(callSettingsPreview.camStream);
    callSettingsPreview = { micStream: null, camStream: null, meterRaf: null };
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
        stopMicStream(callState.localStream);
        stopStream(callState.screenStream);
    }
    stopCallSettingsPreview();
});
