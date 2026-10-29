/* ============================================================
   BUBBLES — FUN / ENGAGEMENT
   ------------------------------------------------------------
   Небольшие «приколы» для удержания аудитории:
     • 🍪 Пузырёк удачи — ежедневное «предсказание» + серия дней
     • 🎰 Баббл-рулетка — случайный пост из ленты
     • 🎊 Конфетти при новых достижениях
     • 📅 Серия входов — счётчик дней подряд на профиле
   Всё хранится в localStorage, ничего не пишет в базу.
   ============================================================ */

/* ---------- КОНФЕТТИ ---------- */
function showConfetti() {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:hidden;";
    const colors = ["#4fc9f5","#ff6ec7","#7ee56d","#ffe066","#a78bfa","#ff9f1c"];
    const count = 90;
    for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        const size = 6 + Math.random() * 8;
        p.style.cssText = `position:absolute;left:${Math.random()*100}%;top:-20px;width:${size}px;height:${size}px;background:${colors[i%colors.length]};border-radius:${Math.random()<0.5?"50%":"2px"};opacity:.9;`;
        p.style.animation = `confettiFall ${1.6 + Math.random()*1.4}s ease-out forwards`;
        p.style.animationDelay = (Math.random()*0.4) + "s";
        p.style.transform = `rotate(${Math.random()*360}deg)`;
        box.appendChild(p);
    }
    if (!document.getElementById("confettiStyle")) {
        const st = document.createElement("style");
        st.id = "confettiStyle";
        st.textContent = `@keyframes confettiFall { 0%{transform:translateY(0) rotate(0deg);opacity:1;} 100%{transform:translateY(110vh) rotate(720deg);opacity:0;} }`;
        document.head.appendChild(st);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3200);
}

// Wrap grantAchievement to trigger confetti on new unlocks.
(function () {
    if (typeof grantAchievement !== "function") return;
    const orig = grantAchievement;
    grantAchievement = async function (userId, achievementId) {
        const before = (getUser(userId)?.unlockedAchievements || []).slice();
        const res = await orig(userId, achievementId);
        const after = getUser(userId)?.unlockedAchievements || [];
        if (after.length > before.length) {
            showConfetti();
            const ach = (typeof ACHIEVEMENTS !== "undefined" ? ACHIEVEMENTS : []).find(a => a.id === achievementId);
            if (ach) toast(`🏆 Новое достижение: ${ach.icon} ${ach.title}!`);
        }
        return res;
    };
    // expose globally under same name
    window.grantAchievement = grantAchievement;
})();

/* ---------- СЕРИЯ ВХОДОВ ---------- */
function updateLoginStreak() {
    if (!currentUserId) return;
    const key = "bubbles-login-streak";
    let data = { last: "", count: 0 };
    try { data = JSON.parse(localStorage.getItem(key) || "{}") || data; } catch (e) {}
    const today = new Date().toISOString().slice(0, 10);
    if (data.last === today) return data.count;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (data.last === yesterday) data.count = (data.count || 0) + 1;
    else data.count = 1;
    data.last = today;
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
    return data.count;
}

function loginStreakBadgeHtml() {
    const n = updateLoginStreak();
    if (!n || n < 2) return "";
    const fire = n >= 7 ? "🔥🔥" : n >= 3 ? "🔥" : "✨";
    return `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:rgba(255,110,199,.18);color:#c0392b;font-weight:800;font-size:12px;" title="Серия входов подряд">${fire} ${n} дн. подряд</span>`;
}

/* ---------- ПУЗЫРЁК УДАЧИ ---------- */
const FORTUNES = [
    "Сегодня тебе улыбнётся удача — напиши кому-нибудь первым 💌",
    "Твой следующий пост станет вирусным 🫧",
    "Кто-то думает о тебе прямо сейчас 💭",
    "Слушай музыку громче — день будет ярче 🎵",
    "Новый друг уже на пути к тебе 🤝",
    "Ты — главный герой своей ленты ✨",
    "Маленький шаг сегодня = большой результат завтра 🚀",
    "Улыбнись — и пузырьки вокруг станут ярче 😊",
    "Кто-то поставит лайк на твой следующий пост ❤️",
    "Сегодня отличный день, чтобы завести новый трек 🎧",
    "Твоя энергия заразительна — делись ею 🌟",
    "Не забудь отдохнуть — даже пузырьки всплывают не спеша 🫧",
];

function openFortuneCookie() {
    const key = "bubbles-fortune-last";
    const today = new Date().toISOString().slice(0, 10);
    let last = "";
    try { last = localStorage.getItem(key) || ""; } catch (e) {}
    const already = last === today;
    const fortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
    const streak = updateLoginStreak();
    if (!already) { try { localStorage.setItem(key, today); } catch (e) {} }
    showBubblesModal(`
        <div class="modal-header">
            <h3>🍪 Пузырёк удачи</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        <div style="text-align:center;padding:8px 0 14px;">
            <div style="font-size:64px;animation:bubblePopFadeIn .4s ease;">🍪</div>
            <p style="margin:12px 0 6px;font-size:15px;font-weight:800;color:#168fd0;line-height:1.5;">${fortune}</p>
            ${already ? `<p style="color:var(--muted);font-size:12px;margin-top:8px;">Сегодня ты уже открывал(а) пузырёк. Возвращайся завтра за новым!</p>` : `<p style="color:#35b95b;font-size:12px;font-weight:700;margin-top:8px;">+1 к серии дней ${streak > 1 ? "(" + streak + " подряд 🔥)" : ""}</p>`}
        </div>
        <div style="text-align:center;">
            <button class="primary" onclick="closeBubblesModal()">Отлично!</button>
        </div>
    `);
    // playSound("notification"); // sounds/ folder doesn't exist -> 404; skip
}

/* ---------- БАББЛ-РУЛЕТКА ---------- */
function spinRandomPost() {
    const posts = (typeof getFeedPosts === "function" ? getFeedPosts() : (db.posts || []));
    if (!posts.length) { toast("Лента пока пустая 🫧"); return; }
    const p = posts[Math.floor(Math.random() * posts.length)];
    if (typeof goToPost === "function") goToPost(p.id);
    else if (typeof navigate === "function") navigate("feed");
    toast("🎰 Выпал пост: " + (p.content || "").slice(0, 40) + "…");
}

/* ---------- УГАДАЙ ЭМОДЗИ ---------- */
const EMOJI_QUIZ = [
    { word: "любовь", options: ["❤️","💔","💔","💔"], answer: 0 },
    { word: "огонь", options: ["🔥","💧","❄️","🌬️"], answer: 0 },
    { word: "музыка", options: ["🎵","📷","🎨","📚"], answer: 0 },
    { word: "солнце", options: ["☀️","🌙","⭐","🌧️"], answer: 0 },
    { word: "кофе", options: ["☕","🍵","🧃","🥤"], answer: 0 },
    { word: "ракета", options: ["🚀","✈️","🚢","🚗"], answer: 0 },
    { word: "призрак", options: ["👻","🧛","🧟","🧌"], answer: 0 },
    { word: "тыква", options: ["🎃","🍉","🍊","🍑"], answer: 0 },
    { word: "летучая мышь", options: ["🦇","🦅","🦉","🐦"], answer: 0 },
    { word: "конфета", options: ["🍬","🍫","🍪","🍩"], answer: 0 },
];

function startEmojiQuiz() {
    let round = 0;
    let score = 0;
    const total = EMOJI_QUIZ.length;

    function render() {
        if (round >= total) {
            showBubblesModal(`
                <div class="modal-header"><h3>🎯 Угадай эмодзи</h3><button class="modal-close-btn" onclick="closeBubblesModal()">✕</button></div>
                <div style="text-align:center;padding:12px 0;">
                    <div style="font-size:56px;">${score >= 8 ? "🏆" : score >= 5 ? "👍" : "💪"}</div>
                    <p style="font-weight:800;font-size:16px;margin:8px 0;">Итог: ${score}/${total}</p>
                    <p style="color:var(--muted);font-size:13px;">${score >= 8 ? "Отличное знание эмодзи!" : score >= 5 ? "Неплохо!" : "Попробуй ещё раз!"}</p>
                </div>
                <div style="text-align:center;"><button class="primary" onclick="startEmojiQuiz()">Ещё раз</button></div>
            `);
            return;
        }
        const q = EMOJI_QUIZ[round];
        // shuffle options
        const opts = q.options.slice().sort(() => Math.random() - 0.5);
        const correct = q.options[q.answer];
        showBubblesModal(`
            <div class="modal-header"><h3>🎯 Угадай эмодзи (${round+1}/${total})</h3><button class="modal-close-btn" onclick="closeBubblesModal()">✕</button></div>
            <div style="text-align:center;padding:8px 0 12px;">
                <p style="font-size:14px;color:var(--muted);margin:0 0 12px;">Какой эмодзи означает «<b>${q.word}</b>»?</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:260px;margin:0 auto;">
                    ${opts.map(o => `<button class="secondary" style="font-size:36px;padding:14px;" onclick="emojiQuizAnswer('${o}','${correct}')">${o}</button>`).join("")}
                </div>
                <p style="margin-top:10px;font-size:13px;color:var(--muted);">Счёт: <b>${score}</b></p>
            </div>
        `);
    }

    window.emojiQuizAnswer = (chosen, correct) => {
        if (chosen === correct) { score++; playSound("notification"); toast("✅ Верно!"); }
        else { toast("❌ Это было " + correct); }
        round++;
        setTimeout(render, 600);
    };
    render();
}

/* ---------- ВНЕДРЕНИЕ В UI ---------- */
// Добавляем кнопки в сайдбар (десктоп) и в «Ещё» (мобильный) — через делегирование.
function injectFunButtons() {
    // Feed: добавляем ряд кнопок над лентой, если ещё нет.
    const feedTitle = document.querySelector("#page .section-title");
    if (feedTitle && !document.getElementById("funRow")) {
        const row = document.createElement("div");
        row.id = "funRow";
        row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 12px;";
        row.innerHTML = `
            <button class="secondary" onclick="openFortuneCookie()" style="flex:1;min-width:120px;">🍪 Пузырёк удачи</button>
            <button class="secondary" onclick="spinRandomPost()" style="flex:1;min-width:120px;">🎰 Рулетка</button>
            <button class="secondary" onclick="startEmojiQuiz()" style="flex:1;min-width:120px;">🎯 Угадай эмодзи</button>
        `;
        feedTitle.insertAdjacentElement("afterend", row);
    }
    // Серия входов — показываем на профиле.
    const profileName = document.querySelector("#page .profile-name");
    if (profileName && !document.getElementById("streakBadge")) {
        const badge = document.createElement("span");
        badge.id = "streakBadge";
        badge.innerHTML = loginStreakBadgeHtml();
        profileName.appendChild(badge);
    }
}

// Инжектим при каждом navigate.
const _origNavigateFun = (typeof navigate === "function") ? navigate : null;
if (_origNavigateFun) {
    navigate = function (page, id) {
        const r = _origNavigateFun(page, id);
        setTimeout(injectFunButtons, 50);
        return r;
    };
    window.navigate = navigate;
}

// Инжектим и при первом рендере.
setTimeout(injectFunButtons, 1500);

/* ---------- ПЛАВАЮЩИЕ РЕАКЦИИ ---------- */
function floatReaction(emoji, postId) {
    const article = document.querySelector(`[data-bubbles-post-id="${postId}"]`);
    const anchor = article || document.querySelector("#feedPostsList") || document.body;
    const rect = anchor.getBoundingClientRect();
    const el = document.createElement("div");
    el.textContent = emoji;
    el.style.cssText = `position:fixed;left:${rect.left + rect.width/2 + (Math.random()*60-30)}px;top:${rect.top + 20}px;font-size:28px;pointer-events:none;z-index:9999;animation:floatUp 1.4s ease-out forwards;`;
    if (!document.getElementById("floatReactionStyle")) {
        const st = document.createElement("style");
        st.id = "floatReactionStyle";
        st.textContent = `@keyframes floatUp { 0%{transform:translateY(0) scale(1);opacity:1;} 100%{transform:translateY(-90px) scale(1.4);opacity:0;} }`;
        document.head.appendChild(st);
    }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
}

// Wrap toggleReaction to spawn a floating emoji on new reactions.
(function () {
    if (typeof toggleReaction !== "function") return;
    const orig = toggleReaction;
    toggleReaction = async function (postId, emoji) {
        const post = (typeof db !== "undefined" ? db.posts : []).find(p => p.id === postId);
        const wasReacted = !!(post && (post.reactions || []).some(r => r.userId === currentUserId && r.emoji === emoji));
        const res = await orig(postId, emoji);
        if (!wasReacted) floatReaction(emoji || "❤️", postId);
        return res;
    };
    window.toggleReaction = toggleReaction;
})();

/* ---------- СЛУЧАЙНЫЙ ПРОФИЛЬ ---------- */
function openRandomProfile() {
    const users = (db.users || []).filter(u => u.id !== currentUserId);
    if (!users.length) { toast("Пока некого показывать 🫧"); return; }
    const u = users[Math.floor(Math.random() * users.length)];
    if (typeof navigate === "function") navigate("profile", u.id);
    toast("🎲 Случайный профиль: " + (u.displayName || u.username));
}

/* ---------- ПУЗЫРЬ ДНЯ ---------- */
function bubbleOfTheDay() {
    const users = (db.users || []).filter(u => u.id !== currentUserId);
    if (!users.length) return null;
    const day = new Date().toISOString().slice(0, 10);
    let hash = 0;
    for (let i = 0; i < day.length; i++) hash = (hash * 31 + day.charCodeAt(i)) >>> 0;
    return users[hash % users.length];
}

function bubbleOfTheDayHtml() {
    const u = bubbleOfTheDay();
    if (!u) return "";
    const avatar = u.avatar || (typeof defaultAvatar === "function" ? defaultAvatar() : "");
    return `
        <div class="card" style="margin:6px 0 12px;padding:12px;display:flex;align-items:center;gap:12px;">
            <img src="${avatar}" style="width:46px;height:46px;border-radius:50%;object-fit:cover;border:2px solid #fff;box-shadow:0 2px 8px rgba(30,120,150,.2);">
            <div style="flex:1;min-width:0;">
                <div style="font-size:12px;color:var(--muted);font-weight:700;">🫧 Пузырь дня</div>
                <div style="font-weight:900;color:#168fd0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(typeof escapeHtml === "function" ? escapeHtml(u.displayName || u.username) : (u.displayName || u.username))}</div>
            </div>
            <button class="secondary" onclick="navigate('profile','${u.id}')" style="padding:6px 12px;font-size:12px;">Открыть</button>
        </div>
    `;
}

/* ---------- ВНЕДРЕНИЕ ---------- */
const _injectFunButtonsExtra = injectFunButtons;
injectFunButtons = function () {
    _injectFunButtonsExtra();
    // Добавляем «Пузырь дня» и кнопку случайного профиля в ленту.
    const feedTitle = document.querySelector("#page .section-title");
    if (feedTitle && !document.getElementById("bubbleOfDay")) {
        const wrap = document.createElement("div");
        wrap.id = "bubbleOfDay";
        wrap.innerHTML = bubbleOfTheDayHtml() + `<div style="display:flex;gap:8px;margin:0 0 12px;"><button class="secondary" onclick="openRandomProfile()" style="flex:1;">🎲 Случайный профиль</button></div>`;
        feedTitle.insertAdjacentElement("afterend", wrap);
    }
};

// re-export
Object.assign(window, { floatReaction, openRandomProfile, bubbleOfTheDay, bubbleOfTheDayHtml });