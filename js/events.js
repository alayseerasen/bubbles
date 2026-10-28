/* ============================================================
   SEASONAL EVENTS — Хэллоуин, Новый год и всё такое
   ------------------------------------------------------------
   Один ивент = одна запись в SEASONAL_EVENTS ниже. Он сам включается
   и выключается по датам (каждый год), ничего удалять руками не нужно.

   Чтобы добавить новый ивент (например, Новый год):
     1. Скопируй шаблон NEW YEAR из комментария внизу списка,
        раскомментируй и поправь тексты/даты.
     2. В css/style.css найди блок «SEASONAL EVENTS» и скопируй
        :root[data-event="halloween"]{...} под id нового ивента
        (поменяй цвета).
     3. Подними ?v= у events.js, style.css и app.js в index.html.
   Больше ничего трогать не надо.

   Что ивент даёт (всё необязательное — убери поле, и этой части не будет):
     • тема     — цвета приложения (CSS, см. шаг 2)
     • banner   — карточка наверху ленты (+ «тизер» за teaserDays дней)
     • achievement — значок, который можно забрать кнопкой на баннере
     • storyReactions — эмодзи-реакции в историях на время ивента
     • canvasBackgrounds — фоны комнат на время ивента (выбранный
       фон остаётся у человека и после конца ивента)
     • floaters — лёгкие плавающие эмодзи поверх экрана

   Даты — «MM-DD», включительно, каждый год. Ивент может переходить
   через Новый год (start "12-20", end "01-10").

   Проверить ДО начала ивента: открой сайт с ?event=halloween в адресе
   (запомнится на этом устройстве). ?event=off — вернуть как было.
   ============================================================ */
const SEASONAL_EVENTS = [
    {
        id: "halloween",
        name: "Хэллоуин",
        emoji: "🎃",
        start: "10-25",
        end: "11-02",
        teaserDays: 7,
        banner: {
            title: "Хэллоуин в Bubbles",
            text: "Приложение в тыквенных цветах до 2 ноября. Загляни в комнату — там новые жуткие фоны, а в историях появились 🎃👻🦇.",
            teaser: "скоро начнётся — приложение станет тыквенным",
            claim: "Забрать значок"
        },
        storyReactions: ["🎃", "👻", "🦇"],
        canvasBackgrounds: {
            halloween: "linear-gradient(160deg,#1b0f2e,#4a1f6b 55%,#ff7a1a 135%)",
            pumpkin: "linear-gradient(160deg,#ffb347,#ff7a1a 55%,#7a2f00)"
        },
        floaters: ["🦇", "🎃", "👻"],
        achievement: {
            id: "event_halloween",
            icon: "🎃",
            title: "Тыквенный пузырь",
            description: "Забрал(а) хэллоуинский значок"
        }
    }

    /* ---- NEW YEAR (шаблон — раскомментируй и поправь) ----
    ,{
        id: "newyear",
        name: "Новый год",
        emoji: "🎄",
        start: "12-20",
        end: "01-10",
        teaserDays: 7,
        banner: {
            title: "С Новым годом!",
            text: "Снежные цвета до 10 января.",
            teaser: "скоро — приложение станет зимним",
            claim: "Забрать значок"
        },
        storyReactions: ["🎄", "❄️", "🎁"],
        canvasBackgrounds: {
            winter: "linear-gradient(160deg,#a8d8ff,#e8f4ff 55%,#ffffff)"
        },
        floaters: ["❄️", "✨"],
        achievement: { id: "event_newyear", icon: "🎄", title: "Снежный пузырь", description: "Забрал(а) новогодний значок" }
    }
    ---------------------------------------------------------- */
];

// ---------- dates ----------

function eventMD(str) {
    const [m, d] = String(str).split("-").map(Number);
    return m * 100 + d;
}

function eventDayKey(date) {
    return (date.getMonth() + 1) * 100 + date.getDate();
}

function eventInRange(ev, date) {
    const key = eventDayKey(date), a = eventMD(ev.start), b = eventMD(ev.end);
    return a <= b ? (key >= a && key <= b) : (key >= a || key <= b); // second case: wraps over New Year
}

// Whole days from today until the next time this event starts (0 = today).
function eventDaysUntilStart(ev, date) {
    const startMD = eventMD(ev.start);
    const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let start = new Date(date.getFullYear(), Math.floor(startMD / 100) - 1, startMD % 100);
    if (start < today) start = new Date(date.getFullYear() + 1, Math.floor(startMD / 100) - 1, startMD % 100);
    return Math.round((start - today) / 86400000);
}

// ---------- preview + user choice (this device only) ----------

(function captureEventPreviewFromUrl() {
    try {
        const v = new URLSearchParams(location.search).get("event");
        if (v === null) return;
        if (v === "off" || v === "") localStorage.removeItem("bubbles-event-preview");
        else if (SEASONAL_EVENTS.some(e => e.id === v)) localStorage.setItem("bubbles-event-preview", v);
    } catch (e) { /* storage blocked — preview just won't stick */ }
})();

function eventPreviewId() {
    try { return localStorage.getItem("bubbles-event-preview"); } catch (e) { return null; }
}

function eventDecorEnabled() {
    try { return localStorage.getItem("bubbles-event-decor-off") !== "1"; } catch (e) { return true; }
}

// What's going on right now: { event, phase: "active" | "teaser", daysLeft?, preview? } or null.
function seasonalEventState(now = new Date()) {
    const previewId = eventPreviewId();
    if (previewId) {
        const ev = SEASONAL_EVENTS.find(e => e.id === previewId);
        if (ev) return { event: ev, phase: "active", preview: true };
    }
    const active = SEASONAL_EVENTS.find(ev => eventInRange(ev, now));
    if (active) return { event: active, phase: "active" };
    for (const ev of SEASONAL_EVENTS) {
        const days = eventDaysUntilStart(ev, now);
        if (days > 0 && days <= (ev.teaserDays ?? 7)) return { event: ev, phase: "teaser", daysLeft: days };
    }
    return null;
}

function activeSeasonalEvent() {
    const st = seasonalEventState();
    return st && st.phase === "active" ? st.event : null;
}

// ---------- things the rest of the app asks for ----------

// Story reaction row: event emoji first, topped up with the usual ones
// to a max of 6 (the row is 40px buttons — more than 6 won't fit a phone).
function storyReactionChoicesForEvent(base) {
    const ev = activeSeasonalEvent();
    if (!ev || !ev.storyReactions || !eventDecorEnabled()) return base;
    return [...ev.storyReactions, ...base].filter((e, i, arr) => arr.indexOf(e) === i).slice(0, 6);
}

// Every event's backgrounds, merged — so a room keeps showing a background
// somebody picked even after that event is over.
function allEventCanvasBackgrounds() {
    return Object.assign({}, ...SEASONAL_EVENTS.map(e => e.canvasBackgrounds || {}));
}

function activeEventCanvasBackgroundIds() {
    const ev = activeSeasonalEvent();
    return ev && ev.canvasBackgrounds && eventDecorEnabled() ? Object.keys(ev.canvasBackgrounds) : [];
}

function eventAchievementList() {
    return SEASONAL_EVENTS.filter(e => e.achievement).map(e => ({ ...e.achievement, eventId: e.id }));
}

// ---------- applying the look ----------

function applySeasonalEvent() {
    const st = seasonalEventState();
    const root = document.documentElement;
    const on = st && st.phase === "active" && eventDecorEnabled();
    if (on) root.setAttribute("data-event", st.event.id);
    else root.removeAttribute("data-event");
    renderEventFloaters(on ? st.event : null);
}

function renderEventFloaters(ev) {
    // Remove any previously rendered floaters (container-less approach: each
    // floater is its own fixed element, so there is NO full-screen layer that
    // could capture the mouse wheel / block scrolling on PC).
    document.querySelectorAll(".halloween-floater").forEach(el => el.remove());

    if (!ev || !ev.floaters || !ev.floaters.length) return;
    if (!document.body) return;

    // Fixed slots hugging the screen edges (not Math.random()): looks the same every visit, and the
    // drifting emoji stay out of the way of the text in the middle.
    const slots = [3, 9, 86, 92, 97];
    slots.forEach((left, i) => {
        const span = document.createElement("span");
        span.className = "halloween-floater event-floater";
        span.textContent = ev.floaters[i % ev.floaters.length];
        span.style.left = left + "%";
        span.style.animationDelay = (-i * 2.3) + "s";
        span.style.animationDuration = (14 + (i % 3) * 3) + "s";
        span.setAttribute("aria-hidden", "true");
        document.body.appendChild(span);
    });
}

// ---------- гарантированная прокрутка страницы колесом мыши ----------
// На ПК пользователи жаловались, что страница "не листается". Причина
// бывала разной (полноэкранные слои, контейнеры со скрытым overflow и т.п.).
// Этот обработчик в фазе capture гарантирует: если под курсором нет
// настоящего вертикально-прокручиваемого контейнера, колесо всегда
// прокручивает страницу. Внутри чатов/панелей (где есть свой скролл)
// отдаём управление нативному поведению.
(function () {
    function hasVerticalScroll(el) {
        if (!el || el === document.body || el === document.documentElement) return false;
        const s = getComputedStyle(el);
        if (s.overflowY !== "auto" && s.overflowY !== "scroll") return false;
        return el.scrollHeight > el.clientHeight + 2;
    }
    document.addEventListener("wheel", (e) => {
        let el = e.target;
        while (el && el !== document.documentElement) {
            if (hasVerticalScroll(el)) return; // нативный скролл контейнера
            el = el.parentElement;
        }
        if (e.deltaY) {
            window.scrollBy(0, e.deltaY);
            e.preventDefault();
        }
    }, { capture: true, passive: false });
})();
// A PWA can stay open for days — re-check the date whenever it comes back to the screen.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") applySeasonalEvent(); });

// ---------- banner at the top of the feed ----------

function eventBannerHtml() {
    const st = seasonalEventState();
    if (!st) return "";
    const ev = st.event, b = ev.banner || {};
    if (st.phase === "teaser") {
        const n = st.daysLeft;
        const word = (n % 10 === 1 && n % 100 !== 11) ? "день" : ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) ? "дня" : "дней";
        return `<div id="eventBanner" class="event-banner event-banner-teaser"><div class="event-banner-emoji">${ev.emoji}</div><div class="event-banner-body"><strong>${escapeHtml(ev.name)} через ${n} ${word}</strong><span>${escapeHtml(b.teaser || "")}</span></div></div>`;
    }
    const me = typeof getUser === "function" ? getUser(currentUserId) : null;
    const claimed = !!(ev.achievement && me && me.unlockedAchievements && me.unlockedAchievements.includes(ev.achievement.id));
    const decor = eventDecorEnabled();
    return `
        <div id="eventBanner" class="event-banner">
            <div class="event-banner-emoji">${ev.emoji}</div>
            <div class="event-banner-body">
                <strong>${escapeHtml(b.title || ev.name)}</strong>
                <span>${escapeHtml(b.text || "")}</span>
                ${ev.achievement ? (claimed
                    ? `<em class="event-banner-done">✅ Значок «${escapeHtml(ev.achievement.title)}» у тебя</em>`
                    : `<button type="button" class="event-banner-btn" onclick="claimEventReward('${ev.id}')">${ev.achievement.icon} ${escapeHtml(b.claim || "Забрать значок")}</button>`) : ""}
                <button type="button" class="event-banner-btn" onclick="openHalloweenGames()" style="background:linear-gradient(135deg,#ff6ec7,#a78bfa);">🎮 Играть</button>
                <button type="button" class="event-banner-link" onclick="toggleEventDecor()">${decor ? "Выключить оформление" : "Включить оформление"}</button>
            </div>
        </div>
    `;
}

function refreshEventBanner() {
    const el = document.getElementById("eventBanner");
    if (!el) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = eventBannerHtml().trim();
    if (wrapper.firstElementChild) el.replaceWith(wrapper.firstElementChild); else el.remove();
}

function toggleEventDecor() {
    try {
        if (eventDecorEnabled()) localStorage.setItem("bubbles-event-decor-off", "1");
        else localStorage.removeItem("bubbles-event-decor-off");
    } catch (e) { /* can't persist — still applies for this session below */ }
    applySeasonalEvent();
    refreshEventBanner();
}

async function claimEventReward(eventId) {
    const st = seasonalEventState();
    if (!st || st.phase !== "active" || st.event.id !== eventId || !st.event.achievement) return;
    await grantAchievement(currentUserId, st.event.achievement.id);
    refreshEventBanner();
}
