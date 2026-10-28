/* ============================================================
   BUBBLES — ХЭЛЛОУИН-МИНИ-ИГРЫ
   ------------------------------------------------------------
   4 небольшие игры для удержания пользователя на сайте во время
   события. Открываются из баннера Хэллоуина (кнопка "🎮 Играть").
   Все игры самодостаточны (без внешних библиотек), работают
   на ПК и телефоне, не пишут ничего в базу.
   ============================================================ */

let halloweenGameTimer = null;
let halloweenGameActive = false;

function openHalloweenGames() {
    showBubblesModal(`
        <div class="modal-header">
            <h3>🎃 Хэллоуин-игры</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        <p style="text-align:center;color:var(--muted);margin:4px 0 14px;font-size:13px;">
            Выбери игру — они держат в тонусе и поднимают настроение 🦇
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button class="secondary" style="padding:16px 10px;font-size:14px;" onclick="closeBubblesModal();startPumpkinClicker()">🎃 Тыква-кликер<br><small style="font-weight:600;opacity:.7;">10 сек, максимум кликов</small></button>
            <button class="secondary" style="padding:16px 10px;font-size:14px;" onclick="closeBubblesModal();startGhostCatcher()">👻 Лови призраков<br><small style="font-weight:600;opacity:.7;">30 сек, лови их</small></button>
            <button class="secondary" style="padding:16px 10px;font-size:14px;" onclick="closeBubblesModal();startBatFlight()">🦇 Летучая мышь<br><small style="font-weight:600;opacity:.7;">лети, не врезайся</small></button>
            <button class="secondary" style="padding:16px 10px;font-size:14px;" onclick="closeBubblesModal();startMemoryGame()">🍬 Память<br><small style="font-weight:600;opacity:.7;">найди пары</small></button>
        </div>
    `);
}

/* ============================================================
   1) ТЫКВА-КЛИКЕР
   ============================================================ */
function startPumpkinClicker() {
    let score = 0;
    let timeLeft = 10;
    let running = true;

    showBubblesModal(`
        <div class="modal-header">
            <h3>🎃 Тыква-кликер</h3>
            <button class="modal-close-btn" onclick="stopPumpkinClicker()">✕</button>
        </div>
        <div style="text-align:center;margin:6px 0 10px;">
            <div style="font-size:13px;color:var(--muted);">Время: <b id="pkTimer">10</b>с · Очки: <b id="pkScore">0</b></div>
        </div>
        <div id="pkField" style="position:relative;height:260px;background:linear-gradient(180deg,#fff7e6,#ffe9c7);border-radius:18px;overflow:hidden;display:flex;align-items:center;justify-content:center;">
            <button id="pkPumpkin" onclick="pumpkinClick()" style="font-size:96px;background:none;border:0;cursor:pointer;transition:transform .08s;user-select:none;-webkit-user-select:none;">🎃</button>
        </div>
        <p id="pkResult" style="text-align:center;margin-top:10px;font-weight:800;color:#168fd0;"></p>
    `);

    const tick = () => {
        if (!running) return;
        timeLeft--;
        const t = document.getElementById("pkTimer");
        if (t) t.textContent = timeLeft;
        if (timeLeft <= 0) {
            running = false;
            clearInterval(halloweenGameTimer);
            const r = document.getElementById("pkResult");
            if (r) r.textContent = `Итог: ${score} кликов! ${score >= 50 ? "🔥 Отлично!" : score >= 30 ? "👍 Неплохо!" : "💪 Попробуй ещё!"}`;
            const btn = document.getElementById("pkPumpkin");
            if (btn) btn.disabled = true;
        }
    };
    halloweenGameTimer = setInterval(tick, 1000);

    window.pumpkinClick = () => {
        if (!running) return;
        score++;
        const s = document.getElementById("pkScore");
        if (s) s.textContent = score;
        const btn = document.getElementById("pkPumpkin");
        if (btn) { btn.style.transform = "scale(1.25)"; setTimeout(() => { if (btn) btn.style.transform = "scale(1)"; }, 80); }
        // move pumpkin slightly
        const field = document.getElementById("pkField");
        if (field && Math.random() < 0.35) {
            const x = 20 + Math.random() * 60;
            const y = 20 + Math.random() * 60;
            btn.style.position = "absolute";
            btn.style.left = x + "%";
            btn.style.top = y + "%";
            btn.style.transform = "translate(-50%,-50%)";
        }
    };
    window.stopPumpkinClicker = () => { running = false; clearInterval(halloweenGameTimer); closeBubblesModal(); };
}

/* ============================================================
   2) ЛОВИ ПРИЗРАКОВ
   ============================================================ */
function startGhostCatcher() {
    let score = 0;
    let timeLeft = 30;
    let running = true;
    let spawnTimer = null;

    showBubblesModal(`
        <div class="modal-header">
            <h3>👻 Лови призраков</h3>
            <button class="modal-close-btn" onclick="stopGhostCatcher()">✕</button>
        </div>
        <div style="text-align:center;margin:6px 0 10px;">
            <div style="font-size:13px;color:var(--muted);">Время: <b id="gcTimer">30</b>с · Поймано: <b id="gcScore">0</b></div>
        </div>
        <div id="gcField" style="position:relative;height:280px;background:linear-gradient(180deg,#1a0f2e,#2d1b4e);border-radius:18px;overflow:hidden;">
        </div>
        <p id="gcResult" style="text-align:center;margin-top:10px;font-weight:800;color:#a78bfa;"></p>
    `);

    const field = () => document.getElementById("gcField");
    const spawn = () => {
        if (!running) return;
        const f = field();
        if (!f) return;
        const g = document.createElement("div");
        g.textContent = Math.random() < 0.3 ? "👻" : (Math.random() < 0.5 ? "🦇" : "🕷️");
        g.style.cssText = "position:absolute;font-size:34px;cursor:pointer;user-select:none;transition:transform .15s;";
        g.style.left = (5 + Math.random() * 80) + "%";
        g.style.top = (5 + Math.random() * 80) + "%";
        g.onclick = (e) => {
            e.stopPropagation();
            if (!running) return;
            score++;
            const s = document.getElementById("gcScore");
            if (s) s.textContent = score;
            g.style.transform = "scale(1.6)";
            g.style.opacity = "0";
            setTimeout(() => g.remove(), 150);
        };
        f.appendChild(g);
        setTimeout(() => { if (g.parentNode) g.remove(); }, 1400);
    };

    spawnTimer = setInterval(spawn, 650);
    // spawn a few immediately
    for (let i = 0; i < 3; i++) setTimeout(spawn, i * 200);

    const tick = () => {
        if (!running) return;
        timeLeft--;
        const t = document.getElementById("gcTimer");
        if (t) t.textContent = timeLeft;
        if (timeLeft <= 0) {
            running = false;
            clearInterval(halloweenGameTimer);
            clearInterval(spawnTimer);
            const r = document.getElementById("gcResult");
            if (r) r.textContent = `Итог: ${score} призраков! ${score >= 25 ? "🏆 Мастер!" : score >= 15 ? "👍 Хорошо!" : "💪 Ещё раз!"}`;
        }
    };
    halloweenGameTimer = setInterval(tick, 1000);

    window.stopGhostCatcher = () => { running = false; clearInterval(halloweenGameTimer); clearInterval(spawnTimer); closeBubblesModal(); };
}

/* ============================================================
   3) ЛЕТУЧАЯ МЫШЬ — простой раннер
   ============================================================ */
function startBatFlight() {
    showBubblesModal(`
        <div class="modal-header">
            <h3>🦇 Летучая мышь</h3>
            <button class="modal-close-btn" onclick="stopBatFlight()">✕</button>
        </div>
        <div style="text-align:center;margin:6px 0 10px;font-size:13px;color:var(--muted);">
            Тап/клик/пробел — взмах. Избегай тыкв. Счёт: <b id="bfScore">0</b>
        </div>
        <div id="bfField" style="position:relative;height:300px;background:linear-gradient(180deg,#0f0a1e,#1a1033);border-radius:18px;overflow:hidden;">
            <div id="bfBat" style="position:absolute;left:60px;top:140px;font-size:34px;transition:none;user-select:none;">🦇</div>
        </div>
        <p id="bfResult" style="text-align:center;margin-top:10px;font-weight:800;color:#a78bfa;"></p>
        <div style="text-align:center;margin-top:6px;">
            <button class="primary" onclick="batFlap()">Взмахнуть</button>
        </div>
    `);

    const field = () => document.getElementById("bfField");
    const bat = () => document.getElementById("bfBat");
    let y = 140;
    let vel = 0;
    let gravity = 0.45;
    let flap = -7.5;
    let obstacles = [];
    let score = 0;
    let running = true;
    let raf = null;
    let lastSpawn = 0;

    window.batFlap = () => { if (running) vel = flap; };

    const keyHandler = (e) => { if (e.code === "Space") { e.preventDefault(); batFlap(); } };
    document.addEventListener("keydown", keyHandler);
    const clickHandler = () => batFlap();
    field()?.addEventListener("click", clickHandler);

    const loop = (t) => {
        if (!running) return;
        const f = field();
        const b = bat();
        if (!f || !b) return;

        vel += gravity;
        y += vel;
        if (y < 0) { y = 0; vel = 0; }
        if (y > f.clientHeight - 40) { y = f.clientHeight - 40; vel = 0; }
        b.style.top = y + "px";

        // spawn obstacles
        if (t - lastSpawn > 1500) {
            lastSpawn = t;
            const obs = document.createElement("div");
            obs.textContent = "🎃";
            obs.style.cssText = "position:absolute;font-size:30px;right:-40px;user-select:none;";
            const gapTop = 40 + Math.random() * (f.clientHeight - 160);
            obs.style.top = gapTop + "px";
            obs.dataset.top = gapTop;
            f.appendChild(obs);
            obstacles.push(obs);
        }

        // move obstacles
        for (let i = obstacles.length - 1; i >= 0; i--) {
            const o = obstacles[i];
            const cur = parseFloat(o.style.right || "-40");
            const next = cur + 3.2;
            o.style.right = next + "px";
            if (next > f.clientWidth + 40) { o.remove(); obstacles.splice(i, 1); score++; const sc = document.getElementById("bfScore"); if (sc) sc.textContent = score; continue; }
            // collision
            const batRect = b.getBoundingClientRect();
            const obsRect = o.getBoundingClientRect();
            if (batRect.left + 8 < obsRect.right - 6 && batRect.right - 8 > obsRect.left + 6 &&
                batRect.top + 8 < obsRect.bottom - 6 && batRect.bottom - 8 > obsRect.top + 6) {
                running = false;
                const r = document.getElementById("bfResult");
                if (r) r.textContent = `Врезался! Счёт: ${score}. ${score >= 15 ? "🏆 Отлично!" : "💪 Ещё раз!"}`;
            }
        }
        if (running) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    window.stopBatFlight = () => {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        document.removeEventListener("keydown", keyHandler);
        field()?.removeEventListener("click", clickHandler);
        closeBubblesModal();
    };
}

/* ============================================================
   4) ПАМЯТЬ — найди пары
   ============================================================ */
function startMemoryGame() {
    const emojis = ["🎃", "👻", "🦇", "🕷️", "🍬", "🕯️"];
    const cards = [...emojis, ...emojis].sort(() => Math.random() - 0.5);
    let flipped = [];
    let matched = 0;
    let moves = 0;
    let locked = false;

    showBubblesModal(`
        <div class="modal-header">
            <h3>🍬 Память</h3>
            <button class="modal-close-btn" onclick="stopMemoryGame()">✕</button>
        </div>
        <div style="text-align:center;margin:6px 0 10px;font-size:13px;color:var(--muted);">
            Ходов: <b id="mmMoves">0</b> · Найдено: <b id="mmMatched">0</b>/6
        </div>
        <div id="mmGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-width:320px;margin:0 auto;">
        </div>
        <p id="mmResult" style="text-align:center;margin-top:10px;font-weight:800;color:#168fd0;"></p>
    `);

    const grid = document.getElementById("mmGrid");
    cards.forEach((em, idx) => {
        const card = document.createElement("button");
        card.style.cssText = "height:64px;font-size:28px;border-radius:12px;border:2px solid #d5eef3;background:#f4fdff;cursor:pointer;user-select:none;";
        card.dataset.emoji = em;
        card.dataset.index = idx;
        card.textContent = "❓";
        card.onclick = () => {
            if (locked || card.classList.contains("matched") || flipped.includes(card)) return;
            card.textContent = em;
            card.style.background = "#eafcff";
            flipped.push(card);
            if (flipped.length === 2) {
                moves++;
                const m = document.getElementById("mmMoves");
                if (m) m.textContent = moves;
                locked = true;
                const [a, b] = flipped;
                if (a.dataset.emoji === b.dataset.emoji) {
                    a.classList.add("matched");
                    b.classList.add("matched");
                    a.style.background = "#d8f7e0";
                    b.style.background = "#d8f7e0";
                    matched++;
                    const mm = document.getElementById("mmMatched");
                    if (mm) mm.textContent = matched;
                    flipped = [];
                    locked = false;
                    if (matched === 6) {
                        const r = document.getElementById("mmResult");
                        if (r) r.textContent = `Все пары найдены за ${moves} ходов! ${moves <= 10 ? "🏆 Отличная память!" : moves <= 16 ? "👍 Хорошо!" : "💪 Попробуй ещё!"}`;
                    }
                } else {
                    setTimeout(() => {
                        a.textContent = "❓"; b.textContent = "❓";
                        a.style.background = "#f4fdff"; b.style.background = "#f4fdff";
                        flipped = [];
                        locked = false;
                    }, 700);
                }
            }
        };
        grid.appendChild(card);
    });

    window.stopMemoryGame = () => { closeBubblesModal(); };
}

/* cleanup on modal close */
const _origCloseBubblesModalGames = typeof closeBubblesModal === "function" ? closeBubblesModal : null;
function closeBubblesModalGames() {
    if (halloweenGameTimer) { clearInterval(halloweenGameTimer); halloweenGameTimer = null; }
    halloweenGameActive = false;
    if (_origCloseBubblesModalGames) _origCloseBubblesModalGames();
}

// Wrap closeBubblesModal so timers are always cleared, even on backdrop click.
(function () {
    const orig = window.closeBubblesModal;
    window.closeBubblesModal = function () {
        if (halloweenGameTimer) { clearInterval(halloweenGameTimer); halloweenGameTimer = null; }
        if (typeof orig === "function") orig();
    };
})();
Object.assign(window, {
    openHalloweenGames,
    startPumpkinClicker,
    startGhostCatcher,
    startBatFlight,
    startMemoryGame
});