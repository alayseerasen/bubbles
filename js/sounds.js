/* ============================================================
   BUBBLES — ЗВУКИ
   ------------------------------------------------------------
   Рингтон, звук приёма/сброса звонка и звуки уведомлений
   (сообщение, заявка в друзья, лайк/комментарий).

   Все звуки генерируются на лету через Web Audio (простые
   мелодичные сигналы, без mp3-файлов) — работает сразу, без
   загрузки каких-либо ресурсов. Если позже захочешь заменить их
   на настоящие звуковые файлы — см. функцию playFile() внизу,
   она уже готова: положи файл в папку /sounds/<имя>.mp3, и он
   будет использован вместо синтеза автоматически.
   ============================================================ */

function loadSoundSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem("bubbles-sound-settings") || "{}");
        return {
            enabled: saved.enabled !== false,
            volume: typeof saved.volume === "number" ? saved.volume : 0.5
        };
    } catch (e) {
        return { enabled: true, volume: 0.5 };
    }
}

function saveSoundSettingsToStorage() {
    localStorage.setItem("bubbles-sound-settings", JSON.stringify(soundSettings));
}

let soundSettings = loadSoundSettings();
let soundAudioCtx = null;

// Браузеры не дают звуку играть, пока не было явного действия
// пользователя (клика/тапа) — "разблокируем" звук при первом же клике.
function ensureSoundContext() {
    if (!soundAudioCtx) {
        try { soundAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { return null; }
    }
    if (soundAudioCtx.state === "suspended") soundAudioCtx.resume().catch(() => {});
    return soundAudioCtx;
}

document.addEventListener("click", ensureSoundContext, { once: true });
document.addEventListener("touchstart", ensureSoundContext, { once: true });

/* ------------------------------------------------------------
   ГОТОВЫЕ ЗВУКОВЫЕ ФАЙЛЫ (опционально)
   ------------------------------------------------------------
   Если в /sounds/ лежит файл с таким именем — используем его.
   Иначе — играем синтезированный сигнал ниже. Проверяем наличие
   один раз и кешируем результат, чтобы не дёргать сеть на
   каждый чих.
   ------------------------------------------------------------ */

const SOUND_FILES = {
    ring: "sounds/ring.mp3",
    callConnect: "sounds/call-connect.mp3",
    callEnd: "sounds/call-end.mp3",
    message: "sounds/message.mp3",
    friendRequest: "sounds/friend-request.mp3",
    notification: "sounds/notification.mp3"
};

const soundFileCache = new Map(); // name -> HTMLAudioElement | null (null = проверили, файла нет)

function getSoundFile(name) {
    if (soundFileCache.has(name)) return soundFileCache.get(name);
    const path = SOUND_FILES[name];
    if (!path) { soundFileCache.set(name, null); return null; }
    const audio = new Audio(path);
    audio.preload = "auto";
    // Пока не подтвердим, что файл реально грузится, считаем его отсутствующим —
    // так первый вызов ещё может уйти на синтезированный звук, а не тишину.
    soundFileCache.set(name, "pending");
    audio.addEventListener("canplaythrough", () => soundFileCache.set(name, audio), { once: true });
    audio.addEventListener("error", () => soundFileCache.set(name, null), { once: true });
    return "pending";
}

/* ------------------------------------------------------------
   СИНТЕЗ ЗВУКОВ
   ------------------------------------------------------------ */

function playTones(tones) {
    const ctx = ensureSoundContext();
    if (!ctx) return;
    const vol = soundSettings.volume;
    tones.forEach(({ freq, start, duration, type = "sine", gain = 0.2 }) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + start;
        gainNode.gain.setValueAtTime(0.0001, t0);
        gainNode.gain.linearRampToValueAtTime(gain * vol, t0 + 0.03);
        gainNode.gain.linearRampToValueAtTime(0.0001, t0 + duration);
        osc.connect(gainNode).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + duration + 0.02);
    });
}

const SOUND_PATTERNS = {
    // Короткий мягкий "поп" — новое сообщение
    message: () => playTones([{ freq: 660, start: 0, duration: 0.12, gain: 0.18 }]),

    // Тёплый двухнотный перезвон — заявка в друзья
    friendRequest: () => playTones([
        { freq: 523, start: 0,    duration: 0.14, type: "triangle", gain: 0.18 },
        { freq: 659, start: 0.12, duration: 0.18, type: "triangle", gain: 0.18 }
    ]),

    // Тихий короткий блип — лайк/комментарий/уведомление в целом
    notification: () => playTones([{ freq: 880, start: 0, duration: 0.08, gain: 0.12 }]),

    // Восходящий "чирп" — звонок подключился (сработает и у того, кто звонил, и у того, кто принял)
    callConnect: () => playTones([
        { freq: 440, start: 0,    duration: 0.12, gain: 0.22 },
        { freq: 660, start: 0.1,  duration: 0.16, gain: 0.22 }
    ]),

    // Нисходящий двухнотный сигнал — звонок завершён/отклонён/сброшен
    callEnd: () => playTones([
        { freq: 520, start: 0,    duration: 0.14, gain: 0.2 },
        { freq: 330, start: 0.12, duration: 0.22, gain: 0.2 }
    ])
};

/* ------------------------------------------------------------
   ПУБЛИЧНЫЕ ФУНКЦИИ
   ------------------------------------------------------------ */

function playSound(name) {
    if (!soundSettings.enabled) return;
    const file = getSoundFile(name);
    if (file && file !== "pending") {
        const clone = file.cloneNode();
        clone.volume = soundSettings.volume;
        clone.play().catch(() => {});
        return;
    }
    const pattern = SOUND_PATTERNS[name];
    if (pattern) pattern();
}

// Зацикленный звук (рингтон при входящем звонке). Возвращает функцию
// остановки — вызывающий код должен её сохранить и вызвать при
// завершении/отмене звонка.
function startSoundLoop(name, intervalMs = 1500) {
    if (!soundSettings.enabled) return () => {};
    let stopped = false;
    const tick = () => { if (!stopped) playSound(name); };
    tick();
    const interval = setInterval(tick, intervalMs);
    return () => { stopped = true; clearInterval(interval); };
}

function setSoundsEnabled(enabled) {
    soundSettings.enabled = enabled;
    saveSoundSettingsToStorage();
}

function setSoundVolume(volume) {
    soundSettings.volume = Math.max(0, Math.min(1, volume));
    saveSoundSettingsToStorage();
}
