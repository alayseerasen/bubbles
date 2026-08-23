/* ============================================================
   BUBBLES
   Local prototype social network
   ============================================================ */

const MAX_MUSIC_SIZE = 15 * 1024 * 1024;
const MAX_COVER_SIZE = 5 * 1024 * 1024;
const MUSIC_BUCKET = "music";
const QUICK_REACTIONS = ["❤️", "😂", "👍", "😮", "😢"];

/* ============================================================
   ACHIEVEMENTS & STATUS
   ------------------------------------------------------------
   Edit this list to add/change achievements — each just needs an id,
   how it's shown, and a check(userId) using whatever's already loaded
   in `db`. "Manual" ones (no check fn) aren't auto-detected; they're
   granted directly from wherever the moment happens (search
   grantAchievement( in this file) — first_story works this way,
   because expired stories vanish from `db.stories` so there's nothing
   left to check against later.

   Checks that need private data (your own message count, say) guard
   themselves with `id === currentUserId` — they're only ever actually
   RUN for the logged-in person anyway (see recomputeAchievements()),
   this is just so the intent is obvious reading the list.

   Status tiers are just a lookup on HOW MANY are unlocked — no need
   to hand-assign a title per achievement combo. Add achievements
   freely; the tier thresholds below are out of ACHIEVEMENTS.length,
   so they'll naturally need revisiting if the list grows a lot.
   ============================================================ */
const ACHIEVEMENTS = [
    { id: "first_post", icon: "🫧", title: "Первый пузырь", description: "Опубликуй свой первый пост",
        check: (id) => db.posts.some(p => p.authorId === id) },
    { id: "posts_10", icon: "📝", title: "Разговорчивый", description: "Опубликуй 10 постов",
        check: (id) => db.posts.filter(p => p.authorId === id).length >= 10 },
    { id: "posts_50", icon: "🌊", title: "Фонтан контента", description: "Опубликуй 50 постов",
        check: (id) => db.posts.filter(p => p.authorId === id).length >= 50 },
    { id: "likes_50", icon: "❤️", title: "Инфлюенсер", description: "Получи 50 лайков суммарно",
        check: (id) => db.posts.filter(p => p.authorId === id).reduce((sum, p) => sum + p.likes.length, 0) >= 50 },
    { id: "viral_post", icon: "🔥", title: "Вирусный пузырь", description: "Один пост набрал 20+ лайков",
        check: (id) => db.posts.some(p => p.authorId === id && p.likes.length >= 20) },
    { id: "first_friend", icon: "🤝", title: "Не одинок(а)", description: "Найди первого друга",
        check: (id) => db.friends.some(f => f.user1 === id || f.user2 === id) },
    { id: "friends_10", icon: "🎉", title: "Душа компании", description: "10 друзей",
        check: (id) => db.friends.filter(f => f.user1 === id || f.user2 === id).length >= 10 },
    { id: "friends_25", icon: "👑", title: "Легенда тусовки", description: "25 друзей",
        check: (id) => db.friends.filter(f => f.user1 === id || f.user2 === id).length >= 25 },
    { id: "first_message", icon: "💬", title: "Ледокол", description: "Отправь первое сообщение",
        check: (id) => id === currentUserId && db.messages.some(m => m.from === id) },
    { id: "messages_100", icon: "🗨️", title: "Болтушка", description: "Отправь 100 сообщений",
        check: (id) => id === currentUserId && db.messages.filter(m => m.from === id).length >= 100 },
    { id: "first_save", icon: "🎧", title: "Меломан", description: "Сохрани трек в библиотеку",
        check: (id) => id === currentUserId && mySavedMusicIds.size >= 1 },
    { id: "dj", icon: "🎚️", title: "Диджей", description: "Загрузи свой первый трек",
        check: (id) => db.music.some(m => m.authorId === id) },
    { id: "first_story", icon: "📸", title: "На виду", description: "Опубликуй первую историю" }, // manual — see grantAchievement( calls
    { id: "veteran_30", icon: "🕰️", title: "Ветеран", description: "Аккаунту 30 дней",
        check: (id) => { const u = getUser(id); return !!u && (Date.now() - u.createdAt) >= 30 * 86400000; } },
    { id: "veteran_180", icon: "🏛️", title: "Старожил", description: "Аккаунту 180 дней",
        check: (id) => { const u = getUser(id); return !!u && (Date.now() - u.createdAt) >= 180 * 86400000; } }
];

// Ordered low → high; whichever's the LAST one your unlocked count
// still clears wins. Nothing at 0 on purpose — no badge until you've
// actually done something.
const STATUS_TIERS = [
    { min: 1, icon: "🫧", title: "Бабблер" },
    { min: 3, icon: "✨", title: "Супер Бабблер" },
    { min: 6, icon: "💫", title: "Гуру Пузырей" },
    { min: 10, icon: "👑", title: (gender) => gender === "male" ? "Король Пузырей" : "Королева Пузырей" },
    { min: 13, icon: "🌟", title: "Легенда Bubbles" }
];

function getStatusTier(user) {
    if (!user) return null;
    if (user.customStatusTitle) return { icon: user.customStatusIcon || "🌟", title: user.customStatusTitle };
    const count = user.achievementLevel || 0;
    let tier = null;
    for (const t of STATUS_TIERS) if (count >= t.min) tier = t;
    if (!tier) return null;
    return { icon: tier.icon, title: typeof tier.title === "function" ? tier.title(user.gender) : tier.title };
}

function statusBadgeHtml(user, size = "normal") {
    const tier = getStatusTier(user);
    if (!tier) return "";
    const cls = size === "small" ? "status-badge small" : "status-badge";
    return `<span class="${cls}" title="${escapeHtml(tier.title)}">${tier.icon} ${escapeHtml(tier.title)}</span>`;
}

/* ============================================================
   PETS (Tamagotchi-style companion)
   ------------------------------------------------------------
   One companion per account (db.pet, or null before it's adopted).
   Species/appearance is config here (PET_SPECIES), not a DB table —
   same reasoning as ACHIEVEMENTS above: it's static content, easy to
   extend with more characters later, and doesn't need a migration to
   add one. Cosmetics (recoloring, accessories) are a later layer —
   colorPrimary/colorSecondary already round-trip through the DB (see
   rowToPet) but nothing sets them yet, so every pet just renders in
   its species' base colors for now.

   STATS live 0–100: hunger, energy, happiness, cleanliness, plus a
   slower-moving `health` meter that only drifts down when the other
   four have been neglected for a while, and drifts back up on good
   care — it's the "sick" gate, and it's always recoverable, never
   fatal. Actions (feed/play/clean/sleep) nudge the four fast stats;
   nothing acts on health directly.

   TICKING is lazy, like the rest of this app has no server cron:
   - applyPetDecay() is a pure function of (pet, elapsedMs, rate) —
     no I/O, easy to reason about and to unit-test by hand.
   - tickPet() is the only place that actually moves lastTickAt and
     talks to Supabase. It runs in two situations:
       1) once right after loadDB(), with awayCatchUp:true — the gap
          between lastTickAt and now is however long the app was
          CLOSED for, so it decays at PET_OFFLINE_RATE (slower).
       2) every 30s via the heartbeat started in startApp(), with
          awayCatchUp:false — that gap is always ~30s of the app
          being open, so it decays at the normal full rate.
     This is what gives the "decays as usual while you're using
     bubbles, a bit more forgiving while you're away" behavior,
     without needing to know in real time whether the tab is
     foregrounded — the heartbeat only runs while the app is open at
     all, so any large gap found on load could only have happened
     while it was closed.
   ============================================================ */

const PET_SPECIES = [
    {
        id: "aero_orb",
        name: "Аэро-пузырёк",
        description: "Глянцевый пузырь родом из ранних 2000-х — воды и солнечных бликов Frutiger Aero.",
        colorPrimary: "#8be870",
        colorSecondary: "#2fa653"
    }
    // More characters go here later — creating one is just adding an
    // entry to this array (id, name, description, two base colors);
    // renderPetCreature() below draws any of them from those colors.
];

function getPetSpecies(speciesId) {
    return PET_SPECIES.find(s => s.id === speciesId) || PET_SPECIES[0];
}

// Per-hour decay while the app is open and the pet is awake.
const PET_DECAY_RATES = { hunger: 6, cleanliness: 4, happiness: 4, energy: 3 };
// Applied instead of PET_DECAY_RATES for whatever time the app was
// closed — "outside the bubbles" stats still drop, just noticeably
// slower (roughly a third of the normal rate).
const PET_OFFLINE_RATE_MULTIPLIER = 0.4;
// While asleep, the fast stats barely move and energy climbs back up
// instead of draining.
const PET_ASLEEP_DECAY_MULTIPLIER = 0.35;
const PET_ASLEEP_ENERGY_REGEN_PER_HOUR = 14;
// Health drifts down when the four fast stats average below this,
// and drifts up when they average at or above this — dead zone in
// between so it doesn't flicker back and forth.
const PET_HEALTH_DECAY_THRESHOLD = 30;
const PET_HEALTH_REGEN_THRESHOLD = 60;
const PET_HEALTH_DRIFT_PER_HOUR = 4;
const PET_SICK_HEALTH_THRESHOLD = 30;
// Age (from createdAt) needed to reach each stage — also gated on
// health being at least PET_HEALTH_REGEN_THRESHOLD at the moment the
// age threshold is hit, so sustained neglect delays growth instead
// of punishing it any other way (it always catches up once cared for).
const PET_STAGE_HOURS = { juvenile: 24, adult: 4 * 24 };

function clampStat(value) {
    return Math.max(0, Math.min(100, value));
}

// Pure function: given a pet snapshot, how far did elapsedMs of decay
// (at the given hourly rates, before the sleep multiplier) move it?
// Never touches the DB or `db.pet` — tickPet() below is what commits
// the result, so this stays easy to reason about on its own.
function applyPetDecay(pet, elapsedMs, rateMultiplier) {
    const hours = elapsedMs / 3600000;
    if (hours <= 0) return pet;
    const sleepFactor = pet.asleep ? PET_ASLEEP_DECAY_MULTIPLIER : 1;
    const next = { ...pet };
    next.hunger = clampStat(pet.hunger - PET_DECAY_RATES.hunger * hours * rateMultiplier * sleepFactor);
    next.cleanliness = clampStat(pet.cleanliness - PET_DECAY_RATES.cleanliness * hours * rateMultiplier * sleepFactor);
    next.happiness = clampStat(pet.happiness - PET_DECAY_RATES.happiness * hours * rateMultiplier * sleepFactor);
    next.energy = clampStat(pet.asleep
        ? pet.energy + PET_ASLEEP_ENERGY_REGEN_PER_HOUR * hours * rateMultiplier
        : pet.energy - PET_DECAY_RATES.energy * hours * rateMultiplier);

    const careAverage = (next.hunger + next.cleanliness + next.happiness + next.energy) / 4;
    if (careAverage < PET_HEALTH_DECAY_THRESHOLD) {
        next.health = clampStat(pet.health - PET_HEALTH_DRIFT_PER_HOUR * hours * rateMultiplier);
    } else if (careAverage >= PET_HEALTH_REGEN_THRESHOLD) {
        next.health = clampStat(pet.health + PET_HEALTH_DRIFT_PER_HOUR * hours * rateMultiplier);
    } else {
        next.health = pet.health;
    }

    const ageHours = (Date.now() - pet.createdAt) / 3600000;
    if (next.stage === "baby" && ageHours >= PET_STAGE_HOURS.juvenile && next.health >= PET_HEALTH_REGEN_THRESHOLD) {
        next.stage = "juvenile";
    } else if (next.stage === "juvenile" && ageHours >= PET_STAGE_HOURS.adult && next.health >= PET_HEALTH_REGEN_THRESHOLD) {
        next.stage = "adult";
    }

    return next;
}

function isPetSick(pet) {
    return pet.health < PET_SICK_HEALTH_THRESHOLD;
}

// Recomputes db.pet from however long it's actually been, optionally
// writes the result back to Supabase, and optionally treats the gap
// as "away" time (slower rate) vs. "app open" time (normal rate) —
// see the big comment above PET_SPECIES for when each is used.
async function tickPet({ persist = false, awayCatchUp = false } = {}) {
    if (!db.pet) return;
    const elapsedMs = Date.now() - db.pet.lastTickAt;
    if (elapsedMs <= 0) return;
    const rate = awayCatchUp ? PET_OFFLINE_RATE_MULTIPLIER : 1;
    const evolved = applyPetDecay(db.pet, elapsedMs, rate);
    evolved.lastTickAt = Date.now();
    db.pet = evolved;
    if (persist) await savePetToSupabase();
}

async function savePetToSupabase() {
    if (!db.pet || !currentUserId) return;
    const p = db.pet;
    const { error } = await sb.from("pets").update({
        hunger: p.hunger, energy: p.energy, happiness: p.happiness, cleanliness: p.cleanliness,
        health: p.health, stage: p.stage, asleep: p.asleep, name: p.name,
        last_tick_at: new Date(p.lastTickAt).toISOString()
    }).eq("owner_id", currentUserId);
    if (error) console.error("Не удалось сохранить питомца:", error);
}

let petHeartbeatTimer = null;

function startPetHeartbeat() {
    if (petHeartbeatTimer) return;
    petHeartbeatTimer = setInterval(async () => {
        if (!db.pet) return;
        await tickPet({ persist: true, awayCatchUp: false });
        if (currentPage === "pet") renderPet();
    }, 30000);
}

function stopPetHeartbeat() {
    if (petHeartbeatTimer) {
        clearInterval(petHeartbeatTimer);
        petHeartbeatTimer = null;
    }
}

async function createPet(speciesId, name) {
    if (!currentUserId || db.pet) return;
    const species = getPetSpecies(speciesId);
    const nowIso = new Date().toISOString();
    const row = {
        owner_id: currentUserId,
        species_id: species.id,
        name: (name || "").trim().slice(0, 30) || "Пузырёныш",
        stage: "baby",
        hunger: 80, energy: 80, happiness: 80, cleanliness: 80, health: 100,
        asleep: false,
        last_tick_at: nowIso,
        created_at: nowIso
    };
    const { data, error } = await sb.from("pets").insert(row).select().single();
    if (error) {
        console.error(error);
        toast("Не удалось завести питомца.");
        return;
    }
    db.pet = rowToPet(data);
    startPetHeartbeat();
    renderPet();
}

// Shared by every action button: bumps the given stats (clamped),
// optionally reduced if the pet is sick — a gentle nudge to nurse it
// back to full health rather than a hard block — then re-renders
// immediately and persists in the background, same optimistic-update
// pattern as toggleLike().
async function applyPetAction(deltas, { blockIfAsleep = true } = {}) {
    if (!db.pet) return;
    if (blockIfAsleep && db.pet.asleep) {
        toast("Питомец спит — разбуди его сначала 💤");
        return;
    }
    const sickFactor = isPetSick(db.pet) ? 0.7 : 1;
    const next = { ...db.pet };
    Object.entries(deltas).forEach(([stat, delta]) => {
        next[stat] = clampStat(next[stat] + delta * (delta > 0 ? sickFactor : 1));
    });
    db.pet = next;
    renderPet();
    await savePetToSupabase();
}

async function feedPet() {
    await applyPetAction({ hunger: 30, happiness: 3, cleanliness: -4 });
}

async function playPet() {
    if (db.pet && db.pet.energy < 10) {
        toast("Питомец слишком устал играть — дай ему отдохнуть 😴");
        return;
    }
    await applyPetAction({ happiness: 25, energy: -15, hunger: -4, cleanliness: -6 });
}

async function cleanPet() {
    await applyPetAction({ cleanliness: 40, happiness: 3 });
}

async function toggleSleepPet() {
    if (!db.pet) return;
    db.pet = { ...db.pet, asleep: !db.pet.asleep };
    renderPet();
    await savePetToSupabase();
}

function petStageLabel(stage) {
    return stage === "adult" ? "Взрослый" : stage === "juvenile" ? "Подросток" : "Малыш";
}

function petStatBar(label, icon, value) {
    const tier = value < 25 ? "low" : value < 55 ? "mid" : "high";
    return `
        <div class="pet-stat-row">
            <span class="pet-stat-label">${icon} ${label}</span>
            <div class="pet-stat-track">
                <div class="pet-stat-fill ${tier}" style="width:${Math.round(value)}%"></div>
            </div>
        </div>
    `;
}

// Builds the creature as inline SVG with CSS custom properties for
// its two colors, instead of baking hex values into the gradient
// stops directly — so a future recolor cosmetic only has to set
// --pet-color-1/--pet-color-2 on this element, no SVG rebuild needed.
function renderPetCreature(pet) {
    const species = getPetSpecies(pet.speciesId);
    const c1 = pet.colorPrimary || species.colorPrimary;
    const c2 = pet.colorSecondary || species.colorSecondary;
    const sizeScale = pet.stage === "adult" ? 1 : pet.stage === "juvenile" ? 0.9 : 0.78;
    const mood = pet.asleep ? "asleep" : isPetSick(pet) ? "sick" : pet.happiness < 30 ? "sad" : "happy";
    return `
        <div class="pet-creature-wrap ${mood}" style="--pet-color-1:${c1};--pet-color-2:${c2};--pet-scale:${sizeScale}">
            <svg viewBox="0 0 220 260" class="pet-creature-svg">
                <defs>
                    <radialGradient id="petGloss" cx="38%" cy="28%" r="75%">
                        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
                        <stop offset="35%" stop-color="var(--pet-color-1)" stop-opacity="0.9"/>
                        <stop offset="100%" stop-color="var(--pet-color-2)"/>
                    </radialGradient>
                </defs>
                <ellipse cx="110" cy="245" rx="70" ry="10" fill="rgba(20,60,50,.14)"/>
                <path d="M40 250 C40 160 45 130 110 130 C175 130 180 160 180 250 Z" fill="url(#petGloss)" stroke="var(--pet-color-2)" stroke-width="4"/>
                <circle cx="110" cy="78" r="66" fill="url(#petGloss)" stroke="var(--pet-color-2)" stroke-width="4"/>
                <ellipse cx="85" cy="52" rx="22" ry="15" fill="#fff" opacity="0.55"/>
                <g class="pet-face">
                    <circle cx="86" cy="82" r="7" class="pet-eye"/>
                    <circle cx="134" cy="82" r="7" class="pet-eye"/>
                    <path class="pet-mouth" d="M92 104 Q110 118 128 104" fill="none" stroke="#1f4d3a" stroke-width="4" stroke-linecap="round"/>
                </g>
            </svg>
        </div>
    `;
}

function renderPetCreatePrompt() {
    const speciesOptions = PET_SPECIES.map(s => `
        <label class="pet-species-option">
            <input type="radio" name="petSpeciesChoice" value="${s.id}" ${s === PET_SPECIES[0] ? "checked" : ""}>
            <div class="pet-species-card" style="--pet-color-1:${s.colorPrimary};--pet-color-2:${s.colorSecondary}">
                <div class="pet-species-swatch"></div>
                <div>
                    <div class="pet-species-name">${escapeHtml(s.name)}</div>
                    <div class="pet-species-desc">${escapeHtml(s.description)}</div>
                </div>
            </div>
        </label>
    `).join("");
    return `
        <h2 class="section-title">🐣 Питомец</h2>
        <div class="card pet-create-card">
            <p>У тебя пока нет питомца. Выбери персонажа и дай ему имя — раскраску и аксессуары можно будет менять позже.</p>
            <div class="pet-species-list">${speciesOptions}</div>
            <input id="newPetName" class="pet-name-input" placeholder="Имя питомца" maxlength="30">
            <button class="primary full" onclick="submitCreatePet()">Завести питомца 🫧</button>
        </div>
    `;
}

function submitCreatePet() {
    const speciesId = (document.querySelector('input[name="petSpeciesChoice"]:checked') || {}).value || PET_SPECIES[0].id;
    const name = document.getElementById("newPetName").value;
    createPet(speciesId, name);
}

function renderPet() {
    const page = document.getElementById("page");
    if (!page) return;
    if (!db.pet) {
        page.innerHTML = renderPetCreatePrompt();
        return;
    }
    const pet = db.pet;
    const sick = isPetSick(pet);
    page.innerHTML = `
        <h2 class="section-title">🐣 ${escapeHtml(pet.name)}</h2>
        <div class="card pet-card">
            <div class="pet-status-row">
                <span class="pet-stage-badge">${petStageLabel(pet.stage)}</span>
                ${pet.asleep ? `<span class="pet-flag asleep">💤 Спит</span>` : ""}
                ${sick ? `<span class="pet-flag sick">🤒 Приболел</span>` : ""}
            </div>
            ${renderPetCreature(pet)}
            <div class="pet-stats">
                ${petStatBar("Сытость", "🍎", pet.hunger)}
                ${petStatBar("Энергия", "⚡", pet.energy)}
                ${petStatBar("Настроение", "🎈", pet.happiness)}
                ${petStatBar("Чистота", "🫧", pet.cleanliness)}
                ${petStatBar("Здоровье", "💚", pet.health)}
            </div>
            <div class="pet-actions">
                <button class="secondary" onclick="feedPet()" ${pet.asleep ? "disabled" : ""}>🍎 Покормить</button>
                <button class="secondary" onclick="playPet()" ${pet.asleep ? "disabled" : ""}>🎈 Поиграть</button>
                <button class="secondary" onclick="cleanPet()" ${pet.asleep ? "disabled" : ""}>🫧 Помыть</button>
                <button class="secondary" onclick="toggleSleepPet()">${pet.asleep ? "☀️ Разбудить" : "💤 Уложить спать"}</button>
            </div>
        </div>
    `;
}

// Only ever meaningfully accurate for the CURRENTLY LOGGED IN person —
// see the big comment on ACHIEVEMENTS above. Diffs against what's
// already saved on their profile so it only writes to the DB (and only
// congratulates them) when something actually changed.
async function recomputeAchievements() {
    if (!currentUserId) return;
    const me = getUser(currentUserId);
    if (!me) return;
    const computedIds = ACHIEVEMENTS.filter(a => a.check && a.check(currentUserId)).map(a => a.id);
    const newSet = new Set([...me.unlockedAchievements, ...computedIds]); // union: never revoke a manually-granted one just because check() doesn't cover it
    const newlyUnlocked = [...newSet].filter(id => !me.unlockedAchievements.includes(id));
    if (!newlyUnlocked.length) return;
    await persistAchievements(me, [...newSet]);
    newlyUnlocked.forEach(id => {
        const a = ACHIEVEMENTS.find(x => x.id === id);
        if (a) toast(`🏆 Новое достижение: ${a.icon} ${a.title}!`, 5000);
    });
}

// For achievements that can't be re-derived later (see first_story) —
// call this right at the moment the thing happens.
async function grantAchievement(userId, achievementId) {
    if (userId !== currentUserId) return;
    const me = getUser(currentUserId);
    if (!me || me.unlockedAchievements.includes(achievementId)) return;
    const newList = [...me.unlockedAchievements, achievementId];
    await persistAchievements(me, newList);
    const a = ACHIEVEMENTS.find(x => x.id === achievementId);
    if (a) toast(`🏆 Новое достижение: ${a.icon} ${a.title}!`, 5000);
}

async function persistAchievements(user, unlockedIds) {
    const oldLevel = user.achievementLevel || 0;
    user.unlockedAchievements = unlockedIds;
    user.achievementLevel = unlockedIds.length;
    const { error } = await sb.from("profiles")
        .update({ unlocked_achievements: unlockedIds, achievement_level: unlockedIds.length })
        .eq("id", user.id);
    if (error) { console.error("❌ Не удалось сохранить достижения:", error); return; }
    const oldTierCount = STATUS_TIERS.filter(t => oldLevel >= t.min).length;
    const newTierCount = STATUS_TIERS.filter(t => unlockedIds.length >= t.min).length;
    if (newTierCount > oldTierCount) {
        const tier = getStatusTier(user);
        if (tier) toast(`${tier.icon} Новый статус: ${tier.title}!`, 6000);
    }
    if (currentPage === "profile" && selectedProfileId === user.id) renderProfile(user.id);
}

// One-off catch-up for people who joined/posted/friended BEFORE
// achievements existed — recomputeAchievements() only ever runs for
// whoever's currently logged in, so everyone else just sits at 0 until
// they open the app themselves. This runs the same checks for every
// user using only PUBLIC data (posts/comments/friends/likes/tracks) —
// the private ones (your own message count, saved music) are guarded
// with `id === currentUserId` in ACHIEVEMENTS on purpose, so this can
// never grant those to someone else; only the person themselves can,
// by logging in normally.
async function backfillAchievementsForAllUsers() {
    if (!isAdmin()) return;
    if (!confirm(
        `Пересчитать достижения для всех ${db.users.length} пользователей на основе постов/друзей/лайков/треков?\n\n` +
        `Личные достижения (сообщения, сохранённая музыка) так не считаются — их видно только когда человек сам заходит в приложение.`
    )) return;

    toast("Пересчитываю достижения для всех…", 4000);
    let updatedCount = 0;
    for (const user of db.users) {
        const computedIds = ACHIEVEMENTS
            .filter(a => a.check)
            .filter(a => { try { return a.check(user.id); } catch (e) { console.error(e); return false; } })
            .map(a => a.id);
        const newSet = new Set([...user.unlockedAchievements, ...computedIds]);
        if (newSet.size === user.unlockedAchievements.length) continue; // nothing new for this person
        const newList = [...newSet];
        const { error } = await sb.from("profiles")
            .update({ unlocked_achievements: newList, achievement_level: newList.length })
            .eq("id", user.id);
        if (error) { console.error(error); continue; }
        user.unlockedAchievements = newList;
        user.achievementLevel = newList.length;
        updatedCount++;
    }
    toast(`Готово! Обновлено пользователей: ${updatedCount} из ${db.users.length}.`, 6000);
    renderApp();
}

function renderAchievementsBackfillCard() {
    return `
        <div class="card" style="margin-top:14px;">
            <h3 style="margin-top:0;">🏆 Достижения задним числом</h3>
            <div style="opacity:.7;font-size:14px;margin-bottom:10px;">
                Разово досчитывает достижения всем, кто зарегистрировался
                до того, как эта фича появилась (по постам, друзьям,
                лайкам и трекам). Можно жать сколько угодно раз — лишнего
                не насчитает.
            </div>
            <button class="secondary" onclick="backfillAchievementsForAllUsers()">🔁 Пересчитать всем</button>
        </div>
    `;
}

const ACHIEVEMENTS_PREVIEW_COUNT = 6;

function renderAchievementsGrid(user) {
    const expanded = profileAchievementsExpanded;
    // Collapsed view leads with whatever's actually unlocked (more fun to
    // look at + more relevant than just "the first N in config order"),
    // then fills the rest of the preview with locked ones.
    const ordered = expanded ? ACHIEVEMENTS : [
        ...ACHIEVEMENTS.filter(a => user.unlockedAchievements.includes(a.id)),
        ...ACHIEVEMENTS.filter(a => !user.unlockedAchievements.includes(a.id))
    ];
    const shown = expanded ? ordered : ordered.slice(0, ACHIEVEMENTS_PREVIEW_COUNT);
    return `
        <h2 class="section-title">
            🏆 Достижения ${statusBadgeHtml(user)}
        </h2>
        <div class="achievements-grid">
            ${shown.map(a => {
                const unlocked = user.unlockedAchievements.includes(a.id);
                return `
                    <div class="achievement-card ${unlocked ? "unlocked" : "locked"}" title="${escapeHtml(a.description)}">
                        <div class="achievement-icon">${unlocked ? a.icon : "🔒"}</div>
                        <div class="achievement-title">${escapeHtml(a.title)}</div>
                        <div class="achievement-desc">${escapeHtml(a.description)}</div>
                    </div>
                `;
            }).join("")}
        </div>
        ${
            ACHIEVEMENTS.length > ACHIEVEMENTS_PREVIEW_COUNT
            ? `
                <button class="secondary full profile-expand-btn" onclick="toggleProfileAchievementsExpanded()">
                    ${expanded ? "Свернуть ↑" : `Все ${ACHIEVEMENTS.length} →`}
                </button>
            `
            : ""
        }
    `;
}

const sb = window.bubblesSupabase;

// Registered immediately (not gated behind login) purely so the browser
// sees an active service worker early and can offer "Add to Home
// Screen" even from the landing/login page. Requesting notification
// permission and actually subscribing to push, on the other hand, only
// happens once someone's logged in — see subscribeToPush() in startApp().
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("js/sw.js", { scope: "./" }).catch(() => {});
}

let db = {
    users: [],
    posts: [],
    comments: [],
    friends: [],
    friendRequests: [],
    notifications: [],
    messages: [],
    music: [],
    reports: [],
    blocks: [],
    stories: [],
    storyViews: [],
    pet: null // this account's single companion, or null if none created yet
};

let currentUserId = null;
let currentPage = "feed";
let selectedProfileId = null;
let profileMusicExpanded = false;
let profileFriendsExpanded = false;
let profileAchievementsExpanded = false;
let lastProfileRenderId = null;
let selectedChatId = null;
let selectedMessageImage = null; // resized data URL staged to send in the current chat, or null
let selectedComposerMusicId = null; // track staged to attach to the next post, or null
let editPostState = null; // { postId, text, image, musicId } while the edit-post modal is open, or null

// Shared posts (in profile reposts and in DM shares) are carried as a
// control-character-prefixed marker inside the normal message `text`
// field, so no schema or crypto.js change was needed for the DM case —
// it round-trips through the existing per-conversation encryption exactly
// like any other message text.
const SHARED_POST_MARKER = "\u0001bubbles-shared-post:";

function parseSharedPostMessage(text) {
    if (!text || !text.startsWith(SHARED_POST_MARKER)) return null;
    const rest = text.slice(SHARED_POST_MARKER.length);
    const sep = rest.indexOf("\u0001");
    if (sep === -1) return null;
    return { postId: rest.slice(0, sep), caption: rest.slice(sep + 1) };
}
let genderValue = "female";
let currentlyPlayingMusicId = null;
let heartbeatTimer = null;
let onlineCountTimer = null;

/* Music player state */
let musicTab = "mine";           // "mine" | "all"
let musicSearchQuery = "";
let musicQueue = [];             // ids, in the order currently shown
let musicAutoplay = true;
let mySavedMusicIds = new Set(); // tracks (by others) I've added to my library
let savesByUser = new Map();     // userId -> Set(musicId), for everyone (profile counts)

/* Comment reply state — which comment threads currently have their reply
   box open, keyed by the *top-level* comment id, mapped to an optional
   "@username " prefill (used when replying to a reply). */
let openReplyThreads = new Map();

/* Messenger state */
let typingChannel = null;
let typingChannelPartnerId = null;
let typingIndicatorTimer = null;
let messagesChannel = null;
let friendRequestsChannel = null;
let notificationsChannel = null;
let socialChannel = null;
let chatPartnerPresenceTimer = null;

/* ============================================================
   HELPERS
   ============================================================ */

function uid(prefix = "id") {
    return prefix +
        "_" +
        Date.now().toString(36) +
        "_" +
        Math.random()
            .toString(36)
            .slice(2, 8);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getUser(id) {
    return db.users.find(user => user.id === id);
}


function getCurrentUser() {
    return getUser(currentUserId);
}

/* ------------------------------------------------------------
   FRIEND REQUEST HELPERS
   ------------------------------------------------------------ */

// Pending request I sent to userId, if any.
function outgoingRequestTo(userId) {
    return db.friendRequests.find(r => r.fromUser === currentUserId && r.toUser === userId && r.status === "pending");
}

// Pending request userId sent to me, if any.
function incomingRequestFrom(userId) {
    return db.friendRequests.find(r => r.fromUser === userId && r.toUser === currentUserId && r.status === "pending");
}

function myIncomingRequests() {
    return db.friendRequests.filter(r => r.toUser === currentUserId && r.status === "pending");
}

function myOutgoingRequests() {
    return db.friendRequests.filter(r => r.fromUser === currentUserId && r.status === "pending");
}

function isFriend(userId) {
    return db.friends.some(f => (f.user1 === currentUserId && f.user2 === userId) ||
        (f.user2 === currentUserId && f.user1 === userId));
}

/* ------------------------------------------------------------
   BLOCKING
   ------------------------------------------------------------
   One-way and personal — not moderation. Blocking someone hides them
   from your feed/search and stops them messaging or friend-requesting
   you (enforced at the DB level too, see supabase.sql), but it's not
   visible to anyone but you: the blocked person just quietly stops
   reaching you.
   ------------------------------------------------------------ */

function isBlockedByMe(userId) {
    return db.blocks.some(b => b.blockerId === currentUserId && b.blockedId === userId);
}

// The reverse direction — did THEY block ME. We can't read their block
// row (RLS only lets people see their own list), so this only ever
// reflects what we can infer client-side (e.g. a failed send). Kept
// separate from isBlockedByMe so call sites are explicit about which
// direction they mean.
function isBlockedByThem(userId) {
    return db.blocks.some(b => b.blockerId === userId && b.blockedId === currentUserId);
}

async function toggleBlockUser(userId) {
    if (!currentUserId || userId === currentUserId) return;
    const user = getUser(userId);
    if (!user) return;
    const already = isBlockedByMe(userId);
    if (already) {
        const { error } = await sb.from("blocks")
            .delete()
            .eq("blocker_id", currentUserId)
            .eq("blocked_id", userId);
        if (error) { console.error(error); toast("Не удалось разблокировать."); return; }
        db.blocks = db.blocks.filter(b => !(b.blockerId === currentUserId && b.blockedId === userId));
        toast(`${user.displayName} разблокирован(-а).`);
    } else {
        if (!confirm(`Заблокировать ${user.displayName}? Вы перестанете видеть посты друг друга, а писать сообщения станет невозможно.`))
            return;
        const { data, error } = await sb.from("blocks")
            .insert({ id: uid("block"), blocker_id: currentUserId, blocked_id: userId })
            .select()
            .single();
        if (error) { console.error(error); toast("Не удалось заблокировать."); return; }
        db.blocks.push({ id: data.id, blockerId: data.blocker_id, blockedId: data.blocked_id });
        // Blocking someone you're friends with quietly ends the
        // friendship too — staying "friends" while blocked doesn't make
        // sense, and it would otherwise keep them visible in your chat list.
        const friendship = db.friends.find(f => (f.user1 === currentUserId && f.user2 === userId) || (f.user2 === currentUserId && f.user1 === userId));
        if (friendship) {
            await sb.from("friendships").delete().eq("id", friendship.id);
            db.friends = db.friends.filter(f => f.id !== friendship.id);
        }
        if (selectedChatId === userId) selectedChatId = null;
        toast(`${user.displayName} заблокирован(-а).`);
    }
    renderApp();
}

/* ------------------------------------------------------------
   STORIES (24 часа)
   ------------------------------------------------------------ */

let storyViewerState = null; // { authorId, index, timer }
const STORY_DURATION_MS = 5000;

function activeStories() {
    const now = Date.now();
    return db.stories.filter(s => s.expiresAt > now);
}

function storiesByAuthor(authorId) {
    return activeStories().filter(s => s.authorId === authorId).sort((a,b) => a.createdAt - b.createdAt);
}

function hasUnseenStories(authorId) {
    if (authorId === currentUserId) return false;
    return storiesByAuthor(authorId).some(s => !db.storyViews.some(v => v.storyId === s.id && v.viewerId === currentUserId));
}

// Grouped one entry per author, own account first (if you have any),
// everyone else after sorted unseen-first so new stuff doesn't get
// buried once you've caught up on a few.
function storyRailEntries() {
    const authorIds = [...new Set(activeStories().map(s => s.authorId))];
    const others = authorIds.filter(id => id !== currentUserId)
        .sort((a,b) => (hasUnseenStories(b) ? 1 : 0) - (hasUnseenStories(a) ? 1 : 0));
    const ordered = authorIds.includes(currentUserId) ? [currentUserId, ...others] : others;
    return ordered.map(id => getUser(id)).filter(Boolean);
}

function renderStoryRail() {
    const entries = storyRailEntries();
    const me = getCurrentUser();
    return `
        <div class="story-rail">

            <div class="story-ring-item">
                <div
                    class="story-ring ${storiesByAuthor(currentUserId).length ? "mine" : "empty"}"
                    onclick="${storiesByAuthor(currentUserId).length ? `openStoryViewer('${currentUserId}')` : "addStoryPrompt()"}"
                >
                    <img class="story-ring-avatar" src="${me?.avatar || defaultAvatar()}">
                    ${!storiesByAuthor(currentUserId).length ? `<span class="story-add-badge">+</span>` : ""}
                </div>
                <span class="story-ring-label">Ты</span>
            </div>

            ${entries.filter(u => u.id !== currentUserId).map(u => `
                <div class="story-ring-item">
                    <div class="story-ring ${hasUnseenStories(u.id) ? "unseen" : "seen"}" onclick="openStoryViewer('${u.id}')">
                        <img class="story-ring-avatar" src="${u.avatar || defaultAvatar()}">
                    </div>
                    <span class="story-ring-label">${escapeHtml(u.displayName.split(" ")[0])}</span>
                </div>
            `).join("")}

        </div>
    `;
}

function addStoryPrompt() {
    document.getElementById("storyFileInput")?.remove();
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.id = "storyFileInput";
    input.style.display = "none";
    input.onchange = async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        let image;
        try { image = await resizeImageFile(file, 1080); }
        catch (e) { console.error(e); toast("Не удалось обработать фото."); return; }
        const caption = (prompt("Подпись к истории (необязательно):", "") || "").trim();
        const { data, error } = await sb.from("stories")
            .insert({ id: uid("story"), author_id: currentUserId, image, caption })
            .select()
            .single();
        if (error) { console.error(error); toast("Не удалось опубликовать историю."); return; }
        db.stories.push(rowToStory(data));
        toast("История опубликована! Пропадёт через 24 часа.");
        grantAchievement(currentUserId, "first_story");
        renderApp();
    };
    document.body.appendChild(input);
    input.click();
}

function openStoryViewer(authorId) {
    const stories = storiesByAuthor(authorId);
    if (!stories.length) return;
    storyViewerState = { authorId, index: 0 };
    renderStoryViewer();
}

function closeStoryViewer() {
    if (storyViewerState?.timer) clearTimeout(storyViewerState.timer);
    storyViewerState = null;
    document.getElementById("storyViewerOverlay")?.remove();
}

function storyViewerAdvance(delta) {
    if (!storyViewerState) return;
    const stories = storiesByAuthor(storyViewerState.authorId);
    const nextIndex = storyViewerState.index + delta;
    if (nextIndex < 0) return; // already on the first — do nothing
    if (nextIndex >= stories.length) { closeStoryViewer(); return; }
    storyViewerState.index = nextIndex;
    renderStoryViewer();
}

async function markStorySeen(story) {
    if (story.authorId === currentUserId) return;
    if (db.storyViews.some(v => v.storyId === story.id && v.viewerId === currentUserId)) return;
    const { data, error } = await sb.from("story_views")
        .insert({ id: uid("storyview"), story_id: story.id, viewer_id: currentUserId })
        .select()
        .single();
    if (!error && data) db.storyViews.push({ id: data.id, storyId: data.story_id, viewerId: data.viewer_id });
}

async function deleteCurrentStory() {
    if (!storyViewerState) return;
    const stories = storiesByAuthor(storyViewerState.authorId);
    const story = stories[storyViewerState.index];
    if (!story || story.authorId !== currentUserId) return;
    if (!confirm("Удалить эту историю?")) return;
    const { error } = await sb.from("stories").delete().eq("id", story.id);
    if (error) { console.error(error); toast("Не удалось удалить историю."); return; }
    db.stories = db.stories.filter(s => s.id !== story.id);
    const remaining = storiesByAuthor(storyViewerState.authorId);
    if (!remaining.length) { closeStoryViewer(); renderApp(); return; }
    storyViewerState.index = Math.min(storyViewerState.index, remaining.length - 1);
    renderStoryViewer();
    renderApp();
}

function renderStoryViewer() {
    if (storyViewerState?.timer) clearTimeout(storyViewerState.timer);
    if (!storyViewerState) return;
    const stories = storiesByAuthor(storyViewerState.authorId);
    const story = stories[storyViewerState.index];
    if (!story) { closeStoryViewer(); return; }
    const author = getUser(story.authorId);
    const isMine = story.authorId === currentUserId;
    const viewCount = isMine ? db.storyViews.filter(v => v.storyId === story.id).length : 0;

    markStorySeen(story);

    let overlay = document.getElementById("storyViewerOverlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "storyViewerOverlay";
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
        <div class="story-viewer-overlay">

            <div class="story-progress-row">
                ${stories.map((s, i) => `
                    <div class="story-progress-seg">
                        <div class="story-progress-fill ${i < storyViewerState.index ? "full" : i === storyViewerState.index ? "active" : ""}"></div>
                    </div>
                `).join("")}
            </div>

            <div class="story-viewer-header">
                <img class="story-ring-avatar small" src="${author?.avatar || defaultAvatar()}">
                <strong>${escapeHtml(author?.displayName || "")}</strong>
                <span class="story-time">${timeAgo(story.createdAt)}</span>
                <div style="flex:1;"></div>
                ${isMine ? `<button class="story-viewer-icon-btn" onclick="deleteCurrentStory()" title="Удалить">🗑️</button>` : ""}
                <button class="story-viewer-icon-btn" onclick="closeStoryViewer()" title="Закрыть">✕</button>
            </div>

            <div class="story-viewer-body">
                <div class="story-tap-zone left" onclick="storyViewerAdvance(-1)"></div>
                <div class="story-tap-zone right" onclick="storyViewerAdvance(1)"></div>
                <img class="story-viewer-image" src="${story.image}">
                ${story.caption ? `<div class="story-caption">${escapeHtml(story.caption)}</div>` : ""}
            </div>

            ${isMine ? `<div class="story-view-count">👁️ ${viewCount}</div>` : ""}

        </div>
    `;

    storyViewerState.timer = setTimeout(() => storyViewerAdvance(1), STORY_DURATION_MS);
}

/* ------------------------------------------------------------
   ADMIN / MODERATION HELPERS
   ------------------------------------------------------------ */

function isAdmin(userId = currentUserId) {
    const user = getUser(userId);
    return !!user && user.role === "admin";
}

function isBanned(userId = currentUserId) {
    const user = getUser(userId);
    return !!user && !!user.banned;
}

function defaultAvatar() {
    return "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
                <defs>
                    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
                        <stop stop-color="#8deaff"/>
                        <stop offset="1" stop-color="#56d57c"/>
                    </linearGradient>
                </defs>
                <rect width="200" height="200" rx="100" fill="url(#g)"/>
                <circle cx="100" cy="78" r="35" fill="white" opacity=".9"/>
                <path d="M42 174c8-42 35-59 58-59s50 17 58 59" fill="white" opacity=".9"/>
            </svg>
        `);
}

function defaultMusicCover() {
    return "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
                <defs>
                    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
                        <stop stop-color="#62dcff"/>
                        <stop offset=".5" stop-color="#a0f58d"/>
                        <stop offset="1" stop-color="#4ab9ed"/>
                    </linearGradient>
                </defs>
                <rect width="300" height="300" rx="50" fill="url(#g)"/>
                <circle cx="100" cy="100" r="48" fill="white" opacity=".35"/>
                <circle cx="220" cy="210" r="70" fill="white" opacity=".25"/>
                <text x="150" y="175"
                    text-anchor="middle"
                    font-family="Arial"
                    font-size="65"
                    font-weight="900"
                    fill="white">
                    ♪
                </text>
            </svg>
        `);
}

function timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const sec = Math.floor(diff / 1000);
    if (sec < 60)
        return "только что";
    const min = Math.floor(sec / 60);
    if (min < 60)
        return min + " мин.";
    const hours = Math.floor(min / 60);
    if (hours < 24)
        return hours + " ч.";
    const days = Math.floor(hours / 24);
    if (days < 30)
        return days + " д.";
    return new Date(timestamp)
        .toLocaleDateString("ru-RU");
}

function toast(text, duration = 3000) {
    const container = document.getElementById("toastContainer");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => {
        el.remove();
    }, duration);
}

// Resizes an image (and, importantly, flattens animated GIFs to a single
// still frame) before it's ever stored. This is what stops one huge or
// animated picture from making the whole app slow for everyone — every
// avatar/cover/post image on the site now goes through here first.
function resizeImageFile(file, maxDimension, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            let { width, height } = img;
            if (width > maxDimension || height > maxDimension) {
                if (width >= height) {
                    height = Math.round(height * (maxDimension / width));
                    width = maxDimension;
                } else {
                    width = Math.round(width * (maxDimension / height));
                    height = maxDimension;
                }
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);
            // Drawing to canvas always yields a single static frame, so this
            // also strips GIF animation automatically.
            resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Не удалось обработать изображение.")); };
        img.src = objectUrl;
    });
}

function emptyState(icon, title, text) {
    return `
        <div class="card empty">
            <div class="empty-icon">${icon}</div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(text)}</p>
        </div>
    `;
}

/* ============================================================
   PRESENCE — онлайн-статус и «сейчас слушает»
   ============================================================ */

function isUserOnline(lastSeen){
    if(!lastSeen) return false;
    const diff = Date.now() - new Date(lastSeen).getTime();
    return diff < 60000; // онлайн, если был активен меньше минуты назад
}

async function updateLastSeen(){
    if(!currentUserId) return;
    try{
        const {error} = await sb.from("profiles").update({last_seen:new Date().toISOString()}).eq("id",currentUserId);
        if(error) throw error;
        const me = getCurrentUser();
        if(me) me.lastSeen = new Date().toISOString();
    }catch(error){
        console.error("Не удалось обновить статус онлайн:",error);
    }
}

function startPresenceHeartbeat(){
    updateLastSeen();
    if(heartbeatTimer) return;
    heartbeatTimer = setInterval(updateLastSeen,30000);
}

function stopPresenceHeartbeat(){
    if(heartbeatTimer){
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

function pluralPeople(n){
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "человек";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "человека";
    return "человек";
}

function getOnlineCount(){
    return db.users.filter(u => isUserOnline(u.lastSeen)).length;
}

// Polls everyone's last_seen periodically so the "N онлайн" badge (topbar
// + landing screen) stays roughly live without needing a dedicated
// realtime presence channel. Computes the count straight from the query
// result (not db.users) so it also works pre-login on the landing screen,
// where db.users is still empty.
async function refreshOnlineCount(){
    let rows = [];
    try{
        const { data, error } = await sb.from("profiles").select("id,last_seen");
        if(error) throw error;
        rows = data || [];
        rows.forEach(row => {
            const u = getUser(row.id);
            if(u) u.lastSeen = row.last_seen;
        });
    }catch(error){
        console.error("Не удалось обновить счётчик онлайн:", error);
        return;
    }
    const count = rows.filter(row => isUserOnline(row.last_seen)).length;
    const topbarBadge = document.getElementById("topbarOnlineCount");
    if(topbarBadge) topbarBadge.textContent = `🟢 ${count} онлайн`;
    const landingBadge = document.getElementById("landingOnlineCount");
    if(landingBadge) landingBadge.textContent = `🟢 ${count} ${pluralPeople(count)} сейчас в bubbles`;
}

function startOnlineCountPolling(){
    refreshOnlineCount();
    if(onlineCountTimer) return;
    onlineCountTimer = setInterval(refreshOnlineCount, 20000);
}

function stopOnlineCountPolling(){
    if(onlineCountTimer){
        clearInterval(onlineCountTimer);
        onlineCountTimer = null;
    }
}

/* ============================================================
   AUTH
   ============================================================ */

function showAuth(mode = "landing") {
    document.getElementById("app").innerHTML = `
        <div class="auth-screen">
            <div class="auth-box${mode === "landing" ? " landing-box" : ""}">
                <div class="logo">bubbles</div>
                <div class="logo-sub">маленькая социальная сеть с большим количеством пузырьков</div>
                ${mode === "landing" ? landingScreen() : mode === "login" ? loginForm() : registerForm()}
            </div>
        </div>
    `;
    refreshOnlineCount();
}

function landingScreen() {
    return `
        <p class="landing-description">
            Публикуй посты, слушай и делись музыкой, переписывайся с друзьями —
            и всё это с настоящим end-to-end шифрованием сообщений, которое
            не сможем прочитать даже мы. Заходи, тут пузырьково 🫧
        </p>
        <div id="landingOnlineCount" class="landing-online">
            🟢 считаем, кто сейчас в bubbles...
        </div>
        <button class="primary full" onclick="showAuth('login')">Войти</button>
        <button class="secondary full landing-register-btn" onclick="showAuth('register')">Регистрация</button>
    `;
}

function loginForm() {
    return `
        <form onsubmit="login(event)">
            <div class="form-group">
                <label>Почта</label>
                <input id="loginEmail" type="email" autocomplete="email" required placeholder="you@example.com">
            </div>
            <div class="form-group">
                <label>Пароль</label>
                <input id="loginPassword" type="password" autocomplete="current-password" required placeholder="••••••••">
            </div>
            <button class="primary full">Войти в bubbles</button>
        </form>
        <div class="auth-switch">
            Нет аккаунта?
            <button onclick="showAuth('register')">Создать аккаунт</button>
        </div>
        <button type="button" class="auth-back-link" onclick="showAuth('landing')">← Назад</button>
    `;
}

function registerForm() {
    return `
        <form onsubmit="register(event)">
            <div class="form-group">
                <label>Почта</label>
                <input id="registerEmail" type="email" autocomplete="email" required placeholder="you@example.com">
            </div>
            <div class="form-group">
                <label>Юзернейм</label>
                <input id="registerUsername" required minlength="3" maxlength="25" pattern="[A-Za-z0-9_.-]+" placeholder="например bubbles_user">
            </div>
            <div class="form-group">
                <label>Имя</label>
                <input id="registerName" required maxlength="40" placeholder="Как тебя будут видеть">
            </div>
            <div class="form-group">
                <label>Пароль</label>
                <input id="registerPassword" type="password" required minlength="6" placeholder="минимум 6 символов">
            </div>
            <div class="form-group">
                <label>Пол</label>
                <div class="radio-row">
                    <button type="button" class="gender-btn active" id="femaleGender" onclick="selectGender('female')">♀ Женский</button>
                    <button type="button" class="gender-btn" id="maleGender" onclick="selectGender('male')">♂ Мужской</button>
                </div>
            </div>
            <button class="primary full">Создать аккаунт</button>
        </form>
        <div class="auth-switch">
            Уже есть аккаунт?
            <button onclick="showAuth('login')">Войти</button>
        </div>
        <button type="button" class="auth-back-link" onclick="showAuth('landing')">← Назад</button>
    `;
}

function selectGender(gender) {
    genderValue = gender;
    document
        .getElementById("femaleGender")
        ?.classList.toggle("active", gender === "female");
    document
        .getElementById("maleGender")
        ?.classList.toggle("active", gender === "male");
}

// Both login()/register() AND sb.auth.onAuthStateChange fire after a
// successful sign-in/sign-up — without this guard both would race to call
// loadDB()+startApp() at once, which (among other things) opened the E2E
// passphrase modal twice on top of itself and ate keystrokes. This makes
// sure the actual bootstrap work only ever runs once per session.
let sessionBootstrapUserId = null;
let sessionBootstrapPromise = null;

async function bootstrapSession(user) {
    if (sessionBootstrapUserId === user.id) return sessionBootstrapPromise;
    sessionBootstrapUserId = user.id;
    sessionBootstrapPromise = (async () => {
        await ensureProfile(user);
        currentUserId = user.id;
        await loadDB();
        startApp();
    })();
    try {
        await sessionBootstrapPromise;
    } catch (error) {
        sessionBootstrapUserId = null; // allow a retry (e.g. on next auth event)
        throw error;
    }
    return sessionBootstrapPromise;
}

async function register(event) {
    event.preventDefault();
    const email = document.getElementById("registerEmail").value.trim().toLowerCase();
    const username = document.getElementById("registerUsername").value.trim().toLowerCase();
    const displayName = document.getElementById("registerName").value.trim();
    const password = document.getElementById("registerPassword").value;
    const { data: existing } = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
    if (existing) {
        toast("Такой юзернейм уже занят.");
        return;
    }
    const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
            data: { username, displayName, gender: genderValue }
        }
    });
    if (error) {
        console.error(error);
        toast(error.message || "Не удалось создать аккаунт.");
        return;
    }
    if (!data.session) {
        toast("Аккаунт создан. Проверь почту и подтверди адрес, затем войди.");
        showAuth("login");
        return;
    }
    try {
        await bootstrapSession(data.user);
    }
    catch (error) {
        console.error(error);
        toast("Аккаунт создан, но профиль не удалось создать: " + (error?.message || error), 9000);
    }
}

async function login(event) {
    event.preventDefault();
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
        toast(error.message || "Неверная почта или пароль.");
        return;
    }
    try {
        await bootstrapSession(data.user);
    }
    catch (error) {
        console.error(error);
        toast("Не удалось загрузить профиль: " + (error?.message || error), 9000);
    }
}

async function logout(){
    stopPresenceHeartbeat();
    stopPetHeartbeat();
    stopOnlineCountPolling();
    teardownRealtime();
    closeMusicPlayer();
    await sb.auth.signOut();
    currentUserId = null;
    db = {users:[],posts:[],comments:[],friends:[],friendRequests:[],notifications:[],messages:[],music:[],reports:[],blocks:[],stories:[],storyViews:[],pet:null};
    showAuth("landing");
}

/* ============================================================
   MAIN APP
   ============================================================ */

function startApp(){
    const me = getCurrentUser();
    if(!me){
        logout();
        return;
    }
    if(me.banned){
        toast("Аккаунт заблокирован" + (me.banReason ? ": " + me.banReason : ".") + " Обратись к администратору.", 9000);
        logout();
        return;
    }
    startPresenceHeartbeat();
    if (db.pet) startPetHeartbeat();
    setupMessagesRealtime();
    setupFriendRequestsRealtime();
    setupSocialRealtime();
    setupNotificationsRealtime();
    renderApp();
    startOnlineCountPolling();
    subscribeToPush(); // fire-and-forget — a person who ignores/denies the permission prompt should still get a working app
    recomputeAchievements();
}

function renderApp(){
    const user = getCurrentUser();

    document.getElementById("app").innerHTML = `

        <header class="topbar">

            <div
                class="top-logo"
                onclick="handleLogoTap()"
                style="cursor:pointer"
            >
                bubbles
            </div>


            <div class="search">

                <input
                    id="searchInput"
                    placeholder="Поиск пользователей..."
                    oninput="searchUsers(this.value,'searchInput')"
                >

            </div>


            <div class="top-user">

                <span id="topbarOnlineCount" class="topbar-online-badge" title="Сколько людей сейчас онлайн в bubbles">🟢 …</span>

                <div class="notif-wrap">
                    <button
                        id="notifBellBtn"
                        class="notif-bell-btn"
                        onclick="toggleNotificationsPanel(event)"
                        title="Уведомления"
                    >
                        🔔
                        <span id="notifBadge" class="nav-badge notif-badge hidden"></span>
                    </button>
                </div>

                <button
                    id="themeToggleBtn"
                    class="theme-toggle-btn"
                    onclick="toggleTheme()"
                    title="${getTheme() === "dark" ? "Светлая тема" : "Тёмная тема"}"
                >${getTheme() === "dark" ? "☀️" : "🌙"}</button>

                <img
                    class="mini-avatar"
                    src="${user.avatar || defaultAvatar()}"
                >

                <span>
                    ${escapeHtml(user.displayName)}
                </span>

            </div>

        </header>

        <!--
            Deliberately NOT nested inside <header>: .topbar has a
            backdrop-filter (for the frosted-glass look), and an
            ancestor with backdrop-filter/filter/transform creates its
            own containing block for position:fixed descendants. That
            trapped this panel inside the header's own (lower) stacking
            context, so it rendered UNDER the rest of the page no
            matter how high its z-index was. Living here, as a sibling
            of everything else, its position:fixed is relative to the
            real viewport like it should be.
        -->
        <div id="notifPanel" class="notif-panel hidden"></div>


        <div class="layout">

            <aside class="sidebar">

                <button
                    class="nav-btn"
                    data-page="feed"
                    onclick="navigate('feed')"
                >
                    🏠 Лента
                </button>

                <button
                    class="nav-btn"
                    data-page="profile"
                    onclick="navigate('profile')"
                >
                    👤 Профиль
                    <span id="pendingReportsBadge" class="nav-badge hidden"></span>
                </button>

                <button
                    class="nav-btn"
                    data-page="friends"
                    onclick="navigate('friends')"
                >
                    🫂 Друзья
                    <span id="friendRequestsBadge" class="nav-badge hidden"></span>
                </button>

                <button
                    class="nav-btn"
                    data-page="search"
                    onclick="navigate('search')"
                >
                    🔎 Поиск
                </button>

                <button
                    class="nav-btn"
                    data-page="messages"
                    onclick="navigate('messages')"
                >
                    💬 Сообщения
                    <span id="messagesUnreadBadge" class="nav-badge hidden"></span>
                </button>

                <button
                    class="nav-btn"
                    data-page="music"
                    onclick="navigate('music')"
                >
                    🎵 Музыка
                </button>

                <button
                    class="nav-btn"
                    data-page="pet"
                    onclick="navigate('pet')"
                >
                    🐣 Питомец
                    <span id="petNeedsAttentionBadge" class="nav-badge hidden"></span>
                </button>

                <button
                    class="nav-btn"
                    data-page="edit"
                    onclick="navigate('edit')"
                >
                    ⚙️ Настройки
                </button>

                <div class="back-button">

                    <button
                        class="nav-btn"
                        onclick="location.href='https://alayseerasen.github.io/aeroworld/bubbling.html'"
                    >
                        🫧 Aero World
                    </button>

                    <button
                        class="nav-btn"
                        onclick="logout()"
                    >
                        🚪 Выйти
                    </button>

                </div>

            </aside>


            <main
                id="page"
                class="content"
            ></main>

        </div>

    `;

    navigate(currentPage);
    updateNavBadges();
}

/* ============================================================
   NAVIGATION
   ============================================================ */

function navigate(page, id = null){
    currentPage = page;
    selectedProfileId = id || selectedProfileId;
    closeStoryViewer(); // it's a full-screen modal appended to <body>, outside the normal page — don't leave it floating over the newly navigated-to page

    document.querySelectorAll(".nav-btn[data-page]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === page);
    });

    switch(page){
        case "feed": renderFeed(); break;
        // selectedProfileId was just updated above (id || selectedProfileId) —
        // using it here (not just `id`) matters when navigate("profile") is
        // called with no id, e.g. from renderApp()'s post-action re-render,
        // so it keeps showing whichever profile was open instead of
        // snapping back to your own.
        case "profile": renderProfile(selectedProfileId || currentUserId); break;
        case "friends": renderFriends(); break;
        case "messages": renderMessages(); break;
        case "music": renderMusic(); break;
        case "pet": renderPet(); break;
        case "edit": renderEditProfile(); break;
        case "search": renderSearchResults((id != null ? id : userSearchQuery).trim().toLowerCase()); break;
        default: renderFeed();
    }

    stopWatchingChatPartnerPresence();
    if (page === "messages" && selectedChatId) watchChatPartnerPresence(selectedChatId);

    updateNavBadges();
}

/* ============================================================
   FEED
   ============================================================ */

function renderFeed(){
    const page = document.getElementById("page");
    const posts = [...db.posts].sort((a,b) => b.createdAt - a.createdAt);

    page.innerHTML = `

        <h1 class="section-title">
            🫧 Лента
        </h1>

        ${renderStoryRail()}


        <div class="card">

            <h3>Что нового?</h3>

            <textarea
                id="postText"
                maxlength="1000"
                placeholder="Напиши что-нибудь..."
            ></textarea>


            <div style="
                display:flex;
                justify-content:space-between;
                align-items:center;
                gap:10px;
                margin-top:10px;
                flex-wrap:wrap;
            ">

                <input
                    id="postImage"
                    type="file"
                    accept="image/*"
                    style="max-width:100%;"
                >

                <button
                    type="button"
                    class="secondary"
                    onclick="openMusicPicker('compose')"
                >
                    🎵 Музыка
                </button>

                <button
                    class="primary"
                    onclick="createPost()"
                >
                    Опубликовать
                </button>

            </div>

            <div id="composerMusicChip"></div>

        </div>


        ${
            posts.length
            ? posts.map(renderPost).join("")
            : emptyState(
                "🌊",
                "Лента пока пустая",
                "Опубликуй что-нибудь первым."
            )
        }

    `;

    renderComposerMusicChip();
}

function renderCommentRepliesList(postId, topComment, replies){
    return replies.map(reply => renderCommentRow(postId, reply, topComment)).join("");
}

// Renders one comment row (top-level or reply) plus, if its reply box is
// currently open, the inline reply input right underneath it.
function renderCommentRow(postId, comment, topComment){
    const user = getUser(comment.authorId);
    const liked = comment.likes?.includes(currentUserId);
    const isReply = comment.parentId != null;
    const threadId = topComment ? topComment.id : comment.id;
    const replyBoxOpenHere = openReplyThreads.has(threadId) &&
        (openReplyThreads.get(threadId).anchorId === comment.id);
    // Only send people to a profile that actually exists — a comment from
    // a deleted account still shows "Пользователь" but isn't clickable.
    const goToProfile = user ? `navigate('profile','${user.id}')` : "";

    return `
        <div class="comment${isReply ? " comment-reply" : ""}">

            <img
                class="mini-avatar small comment-avatar"
                src="${user?.avatar || defaultAvatar()}"
                ${user ? `onclick="${goToProfile}" style="cursor:pointer"` : ""}
            >

            <div class="comment-body">

                <strong
                    ${user ? `onclick="${goToProfile}" style="cursor:pointer"` : ""}
                >
                    ${escapeHtml(user?.displayName || "Пользователь")}
                </strong>

                ${escapeHtml(comment.text)}

                <div class="comment-actions">

                    <button
                        class="comment-action-btn ${liked ? "liked" : ""}"
                        onclick="toggleCommentLike('${postId}','${comment.id}')"
                    >
                        ${liked ? "♥" : "♡"}
                        ${comment.likes?.length || 0}
                    </button>

                    <button
                        class="comment-action-btn"
                        onclick="openReplyBox('${postId}','${threadId}','${comment.id}'${
                            isReply ? `,'${escapeHtml(user?.username || "")}'` : ""
                        })"
                    >
                        ↩ Ответить
                    </button>

                    ${
                        comment.authorId === currentUserId || isAdmin()
                        ? `
                            <button
                                class="comment-action-btn"
                                onclick="deleteComment('${postId}','${comment.id}')"
                                title="${comment.authorId === currentUserId ? "Удалить" : "Удалить (админ)"}"
                            >
                                🗑️
                            </button>
                        `
                        : ""
                    }

                    ${
                        comment.authorId !== currentUserId
                        ? `
                            <button
                                class="comment-action-btn"
                                onclick="reportComment('${postId}','${comment.id}')"
                                title="Пожаловаться"
                            >
                                🚩
                            </button>
                        `
                        : ""
                    }

                </div>

                ${
                    replyBoxOpenHere
                    ? renderReplyBox(postId, threadId)
                    : ""
                }

            </div>

        </div>
    `;
}

function renderReplyBox(postId, threadId){
    const state = openReplyThreads.get(threadId);
    const prefill = state?.mention ? `@${state.mention} ` : "";
    return `
        <div class="reply-box" style="display:flex;gap:7px;margin-top:6px;">

            <input
                id="reply-${threadId}"
                placeholder="Ответить..."
                maxlength="300"
                value="${escapeHtml(prefill)}"
            >

            <button
                class="primary"
                onclick="addComment('${postId}','${threadId}')"
            >
                →
            </button>

            <button
                class="action-btn"
                onclick="closeReplyBox('${postId}','${threadId}')"
            >
                ✕
            </button>

        </div>
    `;
}

function renderPost(post){
    const author = getUser(post.authorId);
    if(!author) return "";
    const liked = post.likes?.includes(currentUserId);
    const allComments = db.comments.filter(c => c.postId === post.id).sort((a,b) => a.createdAt - b.createdAt);
    const topComments = allComments.filter(c => !c.parentId);
    const repliesByParent = new Map();
    allComments.filter(c => c.parentId).forEach(c => {
        if (!repliesByParent.has(c.parentId)) repliesByParent.set(c.parentId, []);
        repliesByParent.get(c.parentId).push(c);
    });
    const comments = allComments; // total count (incl. replies) for the 💬 button

    return `

        <article
    class="card post"
    data-bubbles-post-id="${post.id}"
>

            <div class="post-head">

                <img
                    class="mini-avatar"
                    src="${author.avatar || defaultAvatar()}"
                    onclick="navigate('profile','${author.id}')"
                    style="cursor:pointer"
                >


                <div
                    class="post-author"
                    onclick="navigate('profile','${author.id}')"
                    style="cursor:pointer"
                >

                    <strong>
                        ${escapeHtml(author.displayName)}
                    </strong>

                    ${statusBadgeHtml(author, "small")}

                    <small>
                        @${escapeHtml(author.username)}
                        · ${timeAgo(post.createdAt)}
                    </small>

                </div>

            </div>


            ${
                post.text
                ? `<div class="post-content">${escapeHtml(post.text)}</div>`
                : ""
            }


            ${
                post.image
                ? `
                    <img
                        class="post-image"
                        src="${post.image}"
                        alt=""
                    >
                `
                : ""
            }


            ${
                post.musicId && db.music.find(m => m.id === post.musicId)
                ? musicProfileCard(db.music.find(m => m.id === post.musicId))
                : ""
            }


            ${
                post.sharedPostId
                ? renderSharedPostCard(post.sharedPostId)
                : ""
            }


            <div class="post-actions">

                <button
                    class="action-btn ${liked ? "liked" : ""}"
                    onclick="toggleLike('${post.id}')"
                >
                    ${liked ? "♥" : "♡"}
                    ${post.likes?.length || 0}
                </button>


                <button
                    class="action-btn"
                    onclick="focusComment('${post.id}')"
                >
                    💬 ${comments.length}
                </button>


                <button
                    class="action-btn"
                    onclick="openSharePicker('${post.id}')"
                >
                    ↗ Поделиться
                </button>


                ${
                    post.authorId === currentUserId
                    ? `
                        <button
                            class="action-btn"
                            onclick="openEditPost('${post.id}')"
                            title="Редактировать"
                        >
                            ✏️
                        </button>
                    `
                    : ""
                }


                ${
                    post.authorId === currentUserId || isAdmin()
                    ? `
                        <button
                            class="action-btn"
                            onclick="deletePost('${post.id}')"
                            title="${post.authorId === currentUserId ? "Удалить" : "Удалить (админ)"}"
                        >
                            🗑️
                        </button>
                    `
                    : ""
                }

                ${
                    post.authorId !== currentUserId
                    ? `
                        <button
                            class="action-btn"
                            onclick="reportPost('${post.id}')"
                            title="Пожаловаться"
                        >
                            🚩
                        </button>
                    `
                    : ""
                }

            </div>


            <div class="comment-list">

                ${
                    topComments
                    .map(comment => `
                        ${renderCommentRow(post.id, comment, null)}
                        <div class="comment-replies">
                            ${renderCommentRepliesList(post.id, comment, repliesByParent.get(comment.id) || [])}
                        </div>
                    `)
                    .join("")
                }


                <div
                    style="
                        display:flex;
                        gap:7px;
                        margin-top:8px;
                    "
                >

                    <input
                        id="comment-${post.id}"
                        placeholder="Написать комментарий..."
                        maxlength="300"
                    >

                    <button
                        class="primary"
                        onclick="addComment('${post.id}')"
                    >
                        →
                    </button>

                </div>

            </div>

        </article>

    `;
}

async function createPost() {
    const text = document.getElementById("postText")?.value.trim() || "";
    const file = document.getElementById("postImage")?.files[0];
    if (!text && !file && !selectedComposerMusicId) {
        toast("Добавь текст, изображение или музыку.");
        return;
    }
    let image = "";
    if (file) {
        if (!file.type.startsWith("image/")) {
            toast("Можно загружать только изображения.");
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            toast("Изображение слишком большое. Максимум 20 МБ.");
            return;
        }
        try { image = await resizeImageFile(file, 1600); }
        catch (e) { console.error(e); toast("Не удалось обработать изображение."); return; }
    }
    const musicId = selectedComposerMusicId || null;
    const post = { id: uid("post"), authorId: currentUserId, text, image, musicId, sharedPostId: null, likes: [], createdAt: Date.now() };
    db.posts.unshift(post);
    const { error } = await sb.from("posts").insert({
        id: post.id, author_id: post.authorId, text: post.text, image: post.image, music_id: post.musicId, likes: [], created_at: new Date(post.createdAt).toISOString()
    });
    if (error) {
        db.posts = db.posts.filter(p => p.id !== post.id);
        console.error(error);
        toast("Не удалось опубликовать пост.");
        return;
    }
    selectedComposerMusicId = null;
    toast("Пост опубликован!");
    recomputeAchievements();
    renderFeed();
}

// Re-renders just one post card in place, wherever it currently sits in the
// DOM (feed or profile), instead of redrawing the whole list — this is what
// keeps your scroll position stable when you like/comment.
function refreshPostInPlace(postId) {
    const post = db.posts.find(p => p.id === postId);
    const el = document.querySelector(`[data-bubbles-post-id="${postId}"]`);
    if (!post || !el) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderPost(post).trim();
    el.replaceWith(wrapper.firstElementChild);
}

async function toggleLike(postId) {
    const post = db.posts.find(p => p.id === postId);
    if (!post)
        return;
    if (!post.likes) post.likes = [];

    // Update the screen immediately — don't wait on a network round trip
    // first. If someone else likes the same post at nearly the same
    // moment, the live post_likes subscription (setupSocialRealtime)
    // reconciles it a moment later, so this stays correct without
    // feeling slow.
    const wasLiked = post.likes.includes(currentUserId);
    post.likes = wasLiked
        ? post.likes.filter(id => id !== currentUserId)
        : [...post.likes, currentUserId];
    refreshPostInPlace(postId);

    // Each person only ever inserts/deletes their OWN row here, which RLS
    // can safely allow on any post — unlike updating the whole post row,
    // which only the post's author is allowed to do.
    const { error } = wasLiked
        ? await sb.from("post_likes").delete().eq("post_id", postId).eq("user_id", currentUserId)
        : await sb.from("post_likes").insert({ post_id: postId, user_id: currentUserId });

    if (error) {
        console.error(error);
        // roll back on failure
        post.likes = wasLiked ? [...post.likes, currentUserId] : post.likes.filter(id => id !== currentUserId);
        refreshPostInPlace(postId);
        toast("Не удалось поставить лайк.");
        return;
    }

    if (!wasLiked) createNotification({ userId: post.authorId, type: "post_like", postId });
}

async function toggleCommentLike(postId, commentId) {
    const comment = db.comments.find(c => c.id === commentId);
    if (!comment)
        return;
    if (!comment.likes) comment.likes = [];

    // Same optimistic-update-then-reconcile pattern as toggleLike above.
    const wasLiked = comment.likes.includes(currentUserId);
    comment.likes = wasLiked
        ? comment.likes.filter(id => id !== currentUserId)
        : [...comment.likes, currentUserId];
    refreshPostInPlace(postId);

    const { error } = wasLiked
        ? await sb.from("comment_likes").delete().eq("comment_id", commentId).eq("user_id", currentUserId)
        : await sb.from("comment_likes").insert({ comment_id: commentId, user_id: currentUserId });

    if (error) {
        console.error(error);
        comment.likes = wasLiked ? [...comment.likes, currentUserId] : comment.likes.filter(id => id !== currentUserId);
        refreshPostInPlace(postId);
        toast("Не удалось поставить лайк.");
    }
}

// parentId (when given) is always the *top-level* comment id — replies to
// a reply get flattened onto that same top-level comment, with an
// "@username " mention prefilled in the input (see openReplyBox).
async function addComment(postId, parentId = null) {
    const input = parentId
        ? document.getElementById("reply-" + parentId)
        : document.getElementById("comment-" + postId);
    if (!input)
        return;
    const text = input.value.trim();
    if (!text)
        return;
    input.value = "";
    const comment = { id: uid("comment"), postId, authorId: currentUserId, parentId, text, likes: [], createdAt: Date.now() };
    db.comments.push(comment);
    if (parentId) closeReplyBox(postId, parentId, { skipRefresh: true });
    refreshPostInPlace(postId);

    const { error } = await sb.from("comments").insert({
        id: comment.id, post_id: comment.postId, author_id: comment.authorId, parent_comment_id: comment.parentId, text: comment.text, created_at: new Date(comment.createdAt).toISOString()
    });
    if (error) {
        db.comments = db.comments.filter(c => c.id !== comment.id);
        console.error(error);
        toast("Не удалось добавить комментарий.");
        refreshPostInPlace(postId);
        return;
    }

    const post = db.posts.find(p => p.id === postId);
    if (post) createNotification({ userId: post.authorId, type: "post_comment", postId, commentId: comment.id });
}

function focusComment(postId){
    const input = document.getElementById("comment-" + postId);
    if(input){
        input.focus();
        input.scrollIntoView({behavior:"smooth",block:"center"});
    }
}

// Opens the reply input for a comment thread. threadId is always the
// top-level comment id (so replies from anywhere in the thread land in
// the same place); anchorId is the specific comment the box should
// render directly under, and mentionUsername (only set when replying to
// a reply) prefills "@username " in the input.
function openReplyBox(postId, threadId, anchorId, mentionUsername){
    openReplyThreads.set(threadId, { anchorId, mention: mentionUsername || null });
    refreshPostInPlace(postId);
    const input = document.getElementById("reply-" + threadId);
    if (input) {
        input.focus();
        // put the cursor at the end rather than selecting the prefilled text
        const end = input.value.length;
        input.setSelectionRange(end, end);
    }
}

function closeReplyBox(postId, threadId, { skipRefresh = false } = {}){
    openReplyThreads.delete(threadId);
    if (!skipRefresh) refreshPostInPlace(postId);
}

async function deleteComment(postId, commentId) {
    const comment = db.comments.find(c => c.id === commentId);
    if (!comment || (comment.authorId !== currentUserId && !isAdmin()))
        return;
    if (!confirm(comment.authorId === currentUserId ? "Удалить комментарий?" : "Удалить этот комментарий как администратор?"))
        return;

    // Deleting a top-level comment takes its replies with it too — this
    // mirrors the "on delete cascade" on parent_comment_id in supabase.sql,
    // so the DB only needs the one delete call below.
    const idsToRemove = new Set([commentId]);
    db.comments.forEach(c => { if (c.parentId === commentId) idsToRemove.add(c.id); });

    const removed = db.comments.filter(c => idsToRemove.has(c.id));
    db.comments = db.comments.filter(c => !idsToRemove.has(c.id));
    openReplyThreads.delete(commentId);
    refreshPostInPlace(postId);

    const { error } = await sb.from("comments").delete().eq("id", commentId);
    if (error) {
        console.error(error);
        db.comments.push(...removed);
        toast("Не удалось удалить комментарий.");
        refreshPostInPlace(postId);
    }
}

/* ------------------------------------------------------------
   GENERIC MODAL (share picker, edit post, music picker all use this —
   one overlay singleton appended to <body>, same pattern as the story
   viewer overlay)
   ------------------------------------------------------------ */

function showBubblesModal(html) {
    let overlay = document.getElementById("bubblesModalOverlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "bubblesModalOverlay";
        overlay.className = "bubbles-modal-overlay";
        overlay.onclick = (e) => { if (e.target === overlay) closeBubblesModal(); };
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div class="bubbles-modal-card">${html}</div>`;
}

function closeBubblesModal() {
    document.getElementById("bubblesModalOverlay")?.remove();
    editPostState = null;
}

/* ------------------------------------------------------------
   SHARE (to your own profile, or to a friend in messages)
   ------------------------------------------------------------ */

function openSharePicker(postId){
    const post = db.posts.find(p => p.id === postId);
    if(!post) return;
    showBubblesModal(`
        <div class="modal-header">
            <h3>Поделиться</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        <div class="share-options">
            <button class="share-option-btn" onclick="openShareToProfile('${postId}')">
                <span class="share-option-icon">🫧</span>
                <span>В профиль</span>
            </button>
            <button class="share-option-btn" onclick="openShareToChat('${postId}')">
                <span class="share-option-icon">✉️</span>
                <span>В сообщения</span>
            </button>
        </div>
    `);
}

function renderSharedPostPreview(post, author){
    return `
        <div class="shared-post-card">
            <div class="shared-post-card-head">
                <img class="mini-avatar small" src="${author?.avatar || defaultAvatar()}">
                <strong>${escapeHtml(author?.displayName || "Пользователь")}</strong>
            </div>
            ${post.text ? `<div class="shared-post-card-text">${escapeHtml(post.text)}</div>` : ""}
            ${post.image ? `<img class="shared-post-card-image" src="${post.image}">` : ""}
            ${post.musicId && db.music.find(m => m.id === post.musicId) ? musicProfileCard(db.music.find(m => m.id === post.musicId)) : ""}
        </div>
    `;
}

function openShareToProfile(postId){
    const post = db.posts.find(p => p.id === postId);
    if(!post) return;
    const author = getUser(post.authorId);
    showBubblesModal(`
        <div class="modal-header">
            <button class="modal-close-btn" onclick="openSharePicker('${postId}')" title="Назад" style="margin-right:auto;">←</button>
            <h3>В профиль</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        <textarea id="shareCaptionInput" maxlength="500" placeholder="Добавь подпись (необязательно)..."></textarea>
        ${renderSharedPostPreview(post, author)}
        <button class="primary" style="width:100%;margin-top:12px;" onclick="shareToProfile('${postId}')">Опубликовать</button>
    `);
}

async function shareToProfile(postId){
    const original = db.posts.find(p => p.id === postId);
    if(!original) return;
    const caption = document.getElementById("shareCaptionInput")?.value.trim() || "";
    const post = { id: uid("post"), authorId: currentUserId, text: caption, image: "", musicId: null, sharedPostId: postId, likes: [], createdAt: Date.now() };
    db.posts.unshift(post);
    const { error } = await sb.from("posts").insert({
        id: post.id, author_id: post.authorId, text: post.text, image: "", music_id: null, shared_post_id: postId, likes: [], created_at: new Date(post.createdAt).toISOString()
    });
    if(error){
        console.error(error);
        db.posts = db.posts.filter(p => p.id !== post.id);
        toast("Не удалось поделиться постом.");
        return;
    }
    closeBubblesModal();
    toast("Пост опубликован в твоём профиле!");
    if(currentPage === "feed") renderFeed();
    else if(currentPage === "profile") renderProfile(selectedProfileId || currentUserId);
}

function openShareToChat(postId){
    const friends = db.friends
        .filter(f => f.user1 === currentUserId || f.user2 === currentUserId)
        .map(f => getUser(f.user1 === currentUserId ? f.user2 : f.user1))
        .filter(Boolean);

    showBubblesModal(`
        <div class="modal-header">
            <button class="modal-close-btn" onclick="openSharePicker('${postId}')" title="Назад" style="margin-right:auto;">←</button>
            <h3>Отправить другу</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        ${
            friends.length
            ? `
                <div class="share-friend-list">
                    ${friends.map(f => `
                        <button class="share-friend-row" onclick="shareToChat('${postId}','${f.id}')">
                            <img class="mini-avatar small" src="${f.avatar || defaultAvatar()}">
                            <span>${escapeHtml(f.displayName)}</span>
                        </button>
                    `).join("")}
                </div>
              `
            : `<p style="text-align:center;color:var(--muted);padding:20px 0;">Пока нет друзей, чтобы отправить.</p>`
        }
    `);
}

async function shareToChat(postId, toUserId){
    const post = db.posts.find(p => p.id === postId);
    if(!post) return;
    const text = `${SHARED_POST_MARKER}${postId}\u0001`;
    const message = { id: uid("message"), from: currentUserId, to: toUserId, text, image: "", createdAt: Date.now(), readAt: null, reactions: [] };
    db.messages.push(message);
    appendMessageToChat(message, toUserId);

    const row = await buildEncryptedMessageRow(message.id, toUserId, text, "", new Date(message.createdAt).toISOString());
    const { error } = await sb.from("messages").insert(row);
    if(error){
        console.error(error);
        db.messages = db.messages.filter(m => m.id !== message.id);
        toast("Не удалось отправить пост.");
        const bubble = document.querySelector(`[data-bubbles-message-id="${message.id}"]`);
        if(bubble) bubble.remove();
        return;
    }
    closeBubblesModal();
    toast("Пост отправлен!");
}

// A shared post inside a post card (repost on a profile/feed) or inside a
// chat bubble both render as this same compact card. Deliberately doesn't
// look at the original's own sharedPostId — one level deep only, so a
// chain of reposts can't nest indefinitely.
function renderSharedPostCard(originalId, { clickable } = { clickable: true }){
    const original = db.posts.find(p => p.id === originalId);
    if(!original) return `<div class="shared-post-card unavailable">Пост недоступен</div>`;
    const author = getUser(original.authorId);
    if(!author) return `<div class="shared-post-card unavailable">Пост недоступен</div>`;
    const track = original.musicId ? db.music.find(m => m.id === original.musicId) : null;
    return `
        <div class="shared-post-card"${clickable ? ` onclick="navigate('profile','${author.id}')" style="cursor:pointer"` : ""}>
            <div class="shared-post-card-head">
                <img class="mini-avatar small" src="${author.avatar || defaultAvatar()}">
                <strong>${escapeHtml(author.displayName)}</strong>
                <small>@${escapeHtml(author.username)} · ${timeAgo(original.createdAt)}</small>
            </div>
            ${original.text ? `<div class="shared-post-card-text">${escapeHtml(original.text)}</div>` : ""}
            ${original.image ? `<img class="shared-post-card-image" src="${original.image}">` : ""}
            ${track ? musicProfileCard(track) : ""}
        </div>
    `;
}

function focusSharedPost(postId){
    const post = db.posts.find(p => p.id === postId);
    if(!post){ toast("Пост недоступен."); return; }
    navigate("profile", post.authorId);
}

/* ------------------------------------------------------------
   MUSIC PICKER (attach a track to a new post, or swap it while editing)
   ------------------------------------------------------------ */

function openMusicPicker(context){
    const tracks = db.music.filter(m => m.authorId === currentUserId || mySavedMusicIds.has(m.id));
    showBubblesModal(`
        <div class="modal-header">
            <h3>Выбери трек</h3>
            <button
                class="modal-close-btn"
                onclick="${context === "edit" ? "renderEditPostModal()" : "closeBubblesModal()"}"
            >✕</button>
        </div>
        ${
            tracks.length
            ? `
                <div class="music-picker-list">
                    ${tracks.map(m => `
                        <button
                            type="button"
                            class="music-picker-row"
                            onclick="selectComposerMusic('${m.id}','${context}')"
                        >
                            <img class="music-picker-cover" src="${m.cover || defaultMusicCover()}">
                            <span class="music-picker-info">
                                <strong>${escapeHtml(m.title)}</strong>
                                <small>${escapeHtml(m.artist || "")}</small>
                            </span>
                        </button>
                    `).join("")}
                </div>
              `
            : `<p style="text-align:center;color:var(--muted);padding:20px 0;">У тебя пока нет треков — загрузи их во вкладке «Музыка».</p>`
        }
    `);
}

function selectComposerMusic(musicId, context){
    if(context === "edit"){
        if(!editPostState) return;
        editPostState.musicId = musicId;
        renderEditPostModal();
    }else{
        selectedComposerMusicId = musicId;
        closeBubblesModal();
        renderComposerMusicChip();
    }
}

function renderComposerMusicChip(){
    const el = document.getElementById("composerMusicChip");
    if(!el) return;
    if(!selectedComposerMusicId){ el.innerHTML = ""; return; }
    const track = db.music.find(m => m.id === selectedComposerMusicId);
    if(!track){ selectedComposerMusicId = null; el.innerHTML = ""; return; }
    el.innerHTML = `
        <div class="composer-music-chip">
            🎵 <span>${escapeHtml(track.title)}</span>
            <button type="button" class="message-image-remove" onclick="removeComposerMusic()" title="Убрать трек">✕</button>
        </div>
    `;
}

function removeComposerMusic(){
    selectedComposerMusicId = null;
    renderComposerMusicChip();
}

/* ------------------------------------------------------------
   EDIT POST (text, photo, and attached track — all changeable
   after the fact, not just at the moment of posting)
   ------------------------------------------------------------ */

function openEditPost(postId){
    const post = db.posts.find(p => p.id === postId);
    if(!post || post.authorId !== currentUserId) return;
    editPostState = { postId, text: post.text || "", image: post.image || "", musicId: post.musicId || null };
    renderEditPostModal();
}

// Whenever a side-action (remove photo, remove track, opening the music
// picker) is about to rebuild the modal's HTML, pull whatever's currently
// typed in the textarea into editPostState first — otherwise
// renderEditPostModal() would rebuild the textarea from the stale
// editPostState.text and silently discard it.
function syncEditPostTextFromDom(){
    if(!editPostState) return;
    const ta = document.getElementById("editPostText");
    if(ta) editPostState.text = ta.value;
}

function renderEditPostModal(){
    if(!editPostState) return;
    const track = editPostState.musicId ? db.music.find(m => m.id === editPostState.musicId) : null;
    showBubblesModal(`
        <div class="modal-header">
            <h3>Редактировать пост</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>

        <textarea id="editPostText" maxlength="1000" placeholder="Напиши что-нибудь...">${escapeHtml(editPostState.text)}</textarea>

        ${
            editPostState.image
            ? `
                <div class="message-image-preview">
                    <img src="${editPostState.image}">
                    <button type="button" class="message-image-remove" onclick="removeEditPostImage()" title="Убрать фото">✕</button>
                </div>
              `
            : `<input type="file" id="editPostImageInput" accept="image/*" onchange="handleEditPostImageSelect(event)">`
        }

        ${
            track
            ? `
                <div class="composer-music-chip">
                    🎵 <span>${escapeHtml(track.title)}</span>
                    <button type="button" class="message-image-remove" onclick="removeEditPostMusic()" title="Убрать трек">✕</button>
                </div>
              `
            : `<button type="button" class="secondary" onclick="syncEditPostTextFromDom();openMusicPicker('edit')" style="margin-top:8px;">🎵 Добавить трек</button>`
        }

        <button class="primary" style="width:100%;margin-top:12px;" onclick="saveEditPost()">Сохранить</button>
    `);
}

async function handleEditPostImageSelect(event){
    const file = event.target.files[0];
    if(!file) return;
    if(!file.type.startsWith("image/")){ toast("Можно загружать только изображения."); return; }
    if(file.size > 20 * 1024 * 1024){ toast("Изображение слишком большое. Максимум 20 МБ."); return; }
    syncEditPostTextFromDom();
    try { editPostState.image = await resizeImageFile(file, 1600); }
    catch(e){ console.error(e); toast("Не удалось обработать изображение."); return; }
    renderEditPostModal();
}

function removeEditPostImage(){
    if(!editPostState) return;
    syncEditPostTextFromDom();
    editPostState.image = "";
    renderEditPostModal();
}

function removeEditPostMusic(){
    if(!editPostState) return;
    syncEditPostTextFromDom();
    editPostState.musicId = null;
    renderEditPostModal();
}

async function saveEditPost(){
    if(!editPostState) return;
    const { postId } = editPostState;
    const post = db.posts.find(p => p.id === postId);
    if(!post) return;
    const text = document.getElementById("editPostText")?.value.trim() || "";
    const image = editPostState.image || "";
    const musicId = editPostState.musicId || null;
    if(!text && !image && !musicId){
        toast("Добавь текст, изображение или музыку.");
        return;
    }

    const prev = { text: post.text, image: post.image, musicId: post.musicId };
    post.text = text;
    post.image = image;
    post.musicId = musicId;
    refreshPostInPlace(postId);

    const { error } = await sb.from("posts").update({ text, image, music_id: musicId }).eq("id", postId);
    if(error){
        console.error(error);
        Object.assign(post, prev);
        refreshPostInPlace(postId);
        toast("Не удалось сохранить изменения.");
        return;
    }
    closeBubblesModal();
    toast("Пост обновлён!");
}

async function deletePost(postId) {
    const post = db.posts.find(p => p.id === postId);
    if (!post || (post.authorId !== currentUserId && !isAdmin()))
        return;
    if (!confirm(post.authorId === currentUserId ? "Удалить пост?" : "Удалить этот пост как администратор?"))
        return;
    const [postResult, commentResult] = await Promise.all([
        sb.from("posts").delete().eq("id", postId),
        sb.from("comments").delete().eq("post_id", postId)
    ]);
    if (postResult.error || commentResult.error) {
        toast("Не удалось удалить пост.");
        return;
    }
    db.posts = db.posts.filter(p => p.id !== postId);
    db.comments = db.comments.filter(c => c.postId !== postId);
    renderFeed();
}

/* ============================================================
   PROFILE
   ============================================================ */

function toggleProfileMusicExpanded(){
    profileMusicExpanded = !profileMusicExpanded;
    renderProfile(lastProfileRenderId);
}

function toggleProfileFriendsExpanded(){
    profileFriendsExpanded = !profileFriendsExpanded;
    renderProfile(lastProfileRenderId);
}

function toggleProfileAchievementsExpanded(){
    profileAchievementsExpanded = !profileAchievementsExpanded;
    renderProfile(lastProfileRenderId);
}

function renderProfile(userId){
    const user = getUser(userId);
    if(!user){ navigate("feed"); return; }
    if (userId !== lastProfileRenderId) {
        // Fresh visit to a (possibly different) profile — start collapsed.
        // Re-renders of the SAME profile (realtime updates etc.) keep
        // whatever the person had expanded.
        profileMusicExpanded = false;
        profileFriendsExpanded = false;
        profileAchievementsExpanded = false;
        lastProfileRenderId = userId;
    }
    const posts = db.posts.filter(p => p.authorId === user.id).sort((a,b) => b.createdAt - a.createdAt);
    const friends = db.friends.filter(f => f.user1 === user.id || f.user2 === user.id);
    // "Their music" = tracks they uploaded + tracks they saved to their
    // library from someone else — same rule as the "Моя музыка" tab.
    const savedIds = savesByUser.get(user.id) || new Set();
    const music = db.music.filter(m => m.authorId === user.id || savedIds.has(m.id));
    const isMe = user.id === currentUserId;
    const friend = isFriend(user.id);

    document.getElementById("page").innerHTML = `

        <div class="card" style="padding:0;">

            <div
                class="cover"
                style="
                    ${
                        user.cover
                        ? `background-image:url('${user.cover}')`
                        : ""
                    }
                "
            ></div>


            <div class="profile-main">

                <img
                    class="profile-avatar"
                    src="${user.avatar || defaultAvatar()}"
                >


                <div class="profile-info">

                    <div class="profile-name">

                        <h1>
                            ${escapeHtml(user.displayName)}
                        </h1>

                        <div class="username">
                            @${escapeHtml(user.username)}
                        </div>

                        ${statusBadgeHtml(user)}

                        ${isUserOnline(user.lastSeen) ? `<div class="online-status">🟢 Онлайн</div>` : `<div class="offline-status">⚪ Оффлайн</div>`}

                        ${user.currentTrack ? `<div class="now-listening">🎧 Сейчас слушает: ${escapeHtml(user.currentTrack)}${user.currentArtist ? " — " + escapeHtml(user.currentArtist) : ""}</div>` : ""}

                    </div>


                    <div class="profile-actions">

                        ${
                            isMe
                            ? `
                                <button
                                    class="primary"
                                    onclick="navigate('edit')"
                                >
                                    ⚙️ Редактировать
                                </button>
                            `
                            : isBlockedByMe(user.id)
                            ? `
                                <button
                                    class="secondary"
                                    onclick="toggleBlockUser('${user.id}')"
                                >
                                    🚫 Разблокировать
                                </button>
                            `
                            : `
                                ${friendActionButtons(user.id)}

                                ${
                                    friend
                                    ? `
                                        <button
                                            class="primary"
                                            onclick="openChat('${user.id}')"
                                        >
                                            💬 Написать
                                        </button>
                                    `
                                    : ""
                                }

                                <button
                                    class="secondary"
                                    onclick="reportProfile('${user.id}')"
                                    title="Пожаловаться"
                                >
                                    🚩 Пожаловаться
                                </button>

                                <button
                                    class="secondary"
                                    onclick="toggleBlockUser('${user.id}')"
                                    title="Заблокировать"
                                >
                                    🚫 Заблокировать
                                </button>
                            `
                        }

                    </div>

                </div>


                ${
                    user.bio
                    ? `<div class="bio">${escapeHtml(user.bio)}</div>`
                    : ""
                }


                <div class="stats">

                    <div class="stat">
                        <strong>${posts.length}</strong>
                        <span>постов</span>
                    </div>

                    <div class="stat">
                        <strong>${friends.length}</strong>
                        <span>друзей</span>
                    </div>

                    <div class="stat">
                        <strong>${music.length}</strong>
                        <span>треков</span>
                    </div>

                </div>

            </div>

        </div>

        ${isMe && isAdmin() ? renderModerationQueue() + renderAchievementsBackfillCard() : adminProfileControls(user)}

        ${renderAchievementsGrid(user)}


        <h2 class="section-title">
            🎵 Музыка
        </h2>


        ${
            music.length
            ? `
                ${
                    (profileMusicExpanded ? music : music.slice(0, 3))
                        .map(musicProfileCard)
                        .join("")
                }
                ${
                    music.length > 3
                    ? `
                        <button class="secondary full profile-expand-btn" onclick="toggleProfileMusicExpanded()">
                            ${profileMusicExpanded ? "Свернуть ↑" : `Все ${music.length} →`}
                        </button>
                    `
                    : ""
                }
            `
            : emptyState(
                "🎵",
                "Здесь пока нет музыки",
                isMe
                ? "Опубликуй первый трек во вкладке «Музыка»."
                : "Пользователь ещё ничего не публиковал."
            )
        }


        <h2 class="section-title">
            🫂 Друзья
        </h2>


        ${
            friends.length
            ? `
                <div class="friend-grid">

                    ${
                        (profileFriendsExpanded ? friends : friends.slice(0, 3))
                        .map(f => {

                            const id =
                                f.user1 === user.id
                                ? f.user2
                                : f.user1;

                            const friendUser =
                                getUser(id);

                            if(!friendUser)
                                return "";

                            return friendCard(
                                friendUser
                            );

                        })
                        .join("")
                    }

                </div>
                ${
                    friends.length > 3
                    ? `
                        <button class="secondary full profile-expand-btn" onclick="toggleProfileFriendsExpanded()">
                            ${profileFriendsExpanded ? "Свернуть ↑" : `Все ${friends.length} →`}
                        </button>
                    `
                    : ""
                }
            `
            : emptyState(
                "🫂",
                "Друзей пока нет",
                "Здесь появятся друзья пользователя."
            )
        }


        <h2 class="section-title">
            📝 Посты
        </h2>


        ${
            posts.length
            ? posts.map(renderPost).join("")
            : emptyState(
                "🫧",
                "Постов пока нет",
                "Здесь появятся публикации пользователя."
            )
        }

    `;
}

function musicProfileCard(music){
    const author = getUser(music.authorId);

    return `

        <div class="music-card">

            <div class="music-row">

                <img
                    class="music-cover"
                    src="${music.cover || defaultMusicCover()}"
                >

                <div class="music-info">

                    <div class="music-title">
                        ${escapeHtml(music.title)}
                    </div>

                    <div class="music-artist">
                        @${escapeHtml(
                            author?.username || "unknown"
                        )}
                    </div>

                </div>


                <button
                    onclick="playMusic('${music.id}')"
                >
                    ▶️
                </button>

            </div>

        </div>

    `;
}

/* ============================================================
   PROFILE EDIT
   ============================================================ */

function renderEditProfile(){
    const user = getCurrentUser();

    document.getElementById("page").innerHTML = `

        <h1 class="section-title">
            ⚙️ Настройки профиля
        </h1>


        <div class="card">

            <div class="edit-preview">

                <img
                    id="editAvatarPreview"
                    src="${user.avatar || defaultAvatar()}"
                >

                <div>

                    <strong>
                        Фото профиля
                    </strong>

                    <div style="
                        color:#7b9ca9;
                        font-size:12px;
                        margin-top:4px;
                    ">
                        PNG, JPG или WEBP
                    </div>

                </div>

            </div>


            <div class="form-group">

                <label>Аватар</label>

                <input
                    id="editAvatar"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onchange="previewAvatar(this)"
                >

            </div>


            <div class="form-group">

                <label>Обложка профиля</label>

                <input
                    id="editCover"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                >

            </div>


            <div class="form-group">

                <label>Юзернейм</label>

                <input
                    id="editUsername"
                    maxlength="25"
                    value="${escapeHtml(user.username)}"
                >

            </div>


            <div class="form-group">

                <label>Имя</label>

                <input
                    id="editName"
                    maxlength="40"
                    value="${escapeHtml(user.displayName)}"
                >

            </div>


            <div class="form-group">

                <label>Описание</label>

                <textarea
                    id="editBio"
                    maxlength="500"
                    placeholder="Расскажи немного о себе..."
                >${escapeHtml(user.bio || "")}</textarea>

            </div>


            <button
                class="primary"
                onclick="saveProfile()"
            >
                💾 Сохранить изменения
            </button>

        </div>

    `;
}

function previewAvatar(input){
    const file = input.files[0];
    if(!file) return;
    if(!file.type.startsWith("image/")){
        toast("Выбери изображение.");
        input.value = "";
        return;
    }
    resizeImageFile(file, 500)
        .then(dataUrl => { document.getElementById("editAvatarPreview").src = dataUrl; })
        .catch(() => toast("Не удалось обработать изображение."));
}

async function saveProfile() {
    const user = getCurrentUser();
    if (!user)
        return;
    const username = document.getElementById("editUsername").value.trim().toLowerCase();
    const displayName = document.getElementById("editName").value.trim();
    const bio = document.getElementById("editBio").value.trim();
    if (!username || !displayName) {
        toast("Заполни имя и юзернейм.");
        return;
    }
    const taken = db.users.some(u => u.id !== user.id && u.username === username);
    if (taken) {
        toast("Этот юзернейм уже занят.");
        return;
    }
    const avatarFile = document.getElementById("editAvatar")?.files[0];
    const coverFile = document.getElementById("editCover")?.files[0];
    if (avatarFile) {
        if (!avatarFile.type.startsWith("image/")) {
            toast("Выбери изображение.");
            return;
        }
        if (avatarFile.size > 12 * 1024 * 1024) {
            toast("Аватар слишком большой. Максимум 12 МБ.");
            return;
        }
        try { user.avatar = await resizeImageFile(avatarFile, 500); }
        catch (e) { console.error(e); toast("Не удалось обработать аватар."); return; }
    }
    if (coverFile) {
        if (!coverFile.type.startsWith("image/")) {
            toast("Выбери изображение.");
            return;
        }
        if (coverFile.size > 12 * 1024 * 1024) {
            toast("Обложка слишком большая. Максимум 12 МБ.");
            return;
        }
        try { user.cover = await resizeImageFile(coverFile, 1200); }
        catch (e) { console.error(e); toast("Не удалось обработать обложку."); return; }
    }
    user.username = username;
    user.displayName = displayName;
    user.bio = bio;
    const { error } = await sb.from("profiles").update({ username, display_name: displayName, bio, avatar: user.avatar, cover: user.cover }).eq("id", user.id);
    if (error) {
        console.error(error);
        toast("Не удалось сохранить профиль.");
        return;
    }
    toast("Профиль обновлён.");
    renderApp();
}

/* ============================================================
   FRIENDS
   ============================================================ */

function renderFriends(){
    const friends = db.friends.filter(f => f.user1 === currentUserId || f.user2 === currentUserId);
    const users = friends.map(f => getUser(f.user1 === currentUserId ? f.user2 : f.user1)).filter(Boolean);
    const incoming = myIncomingRequests().map(r => ({ request: r, user: getUser(r.fromUser) })).filter(x => x.user);
    const outgoing = myOutgoingRequests().map(r => ({ request: r, user: getUser(r.toUser) })).filter(x => x.user);

    document.getElementById("page").innerHTML = `

        <h1 class="section-title">
            🫂 Друзья
        </h1>

        ${
            incoming.length
            ? `
                <h2 class="section-title" style="font-size:16px;">📩 Заявки в друзья (${incoming.length})</h2>
                <div class="friend-grid">
                    ${incoming.map(({request, user}) => `
                        <div class="friend-card">
                            <img src="${user.avatar || defaultAvatar()}" onclick="navigate('profile','${user.id}')" style="cursor:pointer">
                            <h4>${escapeHtml(user.displayName)}</h4>
                            <p>@${escapeHtml(user.username)}</p>
                            <div style="display:flex;gap:6px;">
                                <button class="primary" style="flex:1;" onclick="acceptFriendRequest('${request.id}','${user.id}')">✓ Принять</button>
                                <button class="secondary" style="flex:1;" onclick="declineFriendRequest('${request.id}')">✕ Отклонить</button>
                            </div>
                        </div>
                    `).join("")}
                </div>
            `
            : ""
        }

        ${
            outgoing.length
            ? `
                <h2 class="section-title" style="font-size:16px;">📤 Отправленные заявки (${outgoing.length})</h2>
                <div class="friend-grid">
                    ${outgoing.map(({request, user}) => `
                        <div class="friend-card">
                            <img src="${user.avatar || defaultAvatar()}" onclick="navigate('profile','${user.id}')" style="cursor:pointer">
                            <h4>${escapeHtml(user.displayName)}</h4>
                            <p>@${escapeHtml(user.username)}</p>
                            <button class="secondary" style="width:100%;" onclick="cancelFriendRequest('${request.id}')">Отменить заявку</button>
                        </div>
                    `).join("")}
                </div>
            `
            : ""
        }

        ${(incoming.length || outgoing.length) ? `<h2 class="section-title" style="font-size:16px;">Мои друзья</h2>` : ""}

        ${
            users.length
            ? `
                <div class="friend-grid">

                    ${users.map(friendCard).join("")}

                </div>
            `
            : emptyState(
                "🌱",
                "Пока нет друзей",
                "Найди пользователей и отправь им заявку в друзья."
            )
        }

    `;
}

function friendCard(user){

    return `

        <div class="friend-card">

            <img
                src="${user.avatar || defaultAvatar()}"
                onclick="navigate('profile','${user.id}')"
                style="cursor:pointer"
            >

            <h4>
                ${escapeHtml(user.displayName)}
            </h4>

            <p>
                @${escapeHtml(user.username)}
            </p>

            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button
                    class="primary"
                    style="flex:1;"
                    onclick="navigate('profile','${user.id}')"
                >
                    Открыть
                </button>
                ${
                    isFriend(user.id)
                    ? `<button class="secondary" style="flex:1;" onclick="openChat('${user.id}')">💬</button>`
                    : friendActionButtons(user.id)
                }
            </div>

        </div>

    `;

}

// Returns the HTML for whatever friend-relationship button a profile/search
// card should show right now: add / requested / accept+decline / friends.
function friendActionButtons(userId) {
    if (userId === currentUserId) return "";
    if (isFriend(userId)) {
        return `<button class="danger" onclick="removeFriend('${userId}')">− Удалить из друзей</button>`;
    }
    const incoming = incomingRequestFrom(userId);
    if (incoming) {
        return `
            <button class="primary" onclick="acceptFriendRequest('${incoming.id}','${userId}')">✓ Принять заявку</button>
            <button class="secondary" onclick="declineFriendRequest('${incoming.id}')">✕ Отклонить</button>
        `;
    }
    const outgoing = outgoingRequestTo(userId);
    if (outgoing) {
        return `<button class="secondary" disabled title="Ожидает ответа">⏳ Заявка отправлена</button>`;
    }
    return `<button class="secondary" onclick="sendFriendRequest('${userId}')">+ Добавить в друзья</button>`;
}

async function sendFriendRequest(userId) {
    if (userId === currentUserId) return;
    const request = { id: uid("freq"), fromUser: currentUserId, toUser: userId, status: "pending", createdAt: Date.now() };
    const { error } = await sb.from("friend_requests").insert({
        id: request.id, from_user: request.fromUser, to_user: request.toUser, status: "pending", created_at: new Date(request.createdAt).toISOString()
    });
    if (error) {
        console.error(error);
        toast("Не удалось отправить заявку.");
        return;
    }
    db.friendRequests.push(request);
    toast("Заявка в друзья отправлена.");
    createNotification({ userId, type: "friend_request" });
    if (currentPage === "profile") renderProfile(selectedProfileId || userId);
    else if (currentPage === "friends") renderFriends();
    updateNavBadges();
}

async function cancelFriendRequest(requestId) {
    const { error } = await sb.from("friend_requests").delete().eq("id", requestId);
    if (error) {
        toast("Не удалось отменить заявку.");
        return;
    }
    db.friendRequests = db.friendRequests.filter(r => r.id !== requestId);
    toast("Заявка отменена.");
    navigate(currentPage, selectedProfileId);
}

async function declineFriendRequest(requestId) {
    const { error } = await sb.from("friend_requests").update({ status: "declined", responded_at: new Date().toISOString() }).eq("id", requestId);
    if (error) {
        toast("Не удалось отклонить заявку.");
        return;
    }
    db.friendRequests = db.friendRequests.filter(r => r.id !== requestId);
    toast("Заявка отклонена.");
    navigate(currentPage, selectedProfileId);
    updateNavBadges();
}

async function acceptFriendRequest(requestId, otherUserId) {
    const friendship = { id: uid("friend"), user1: currentUserId, user2: otherUserId, createdAt: Date.now() };
    const { error: friendError } = await sb.from("friendships").insert({
        id: friendship.id, user1: friendship.user1, user2: friendship.user2, created_at: new Date(friendship.createdAt).toISOString()
    });
    if (friendError) {
        console.error(friendError);
        toast("Не удалось принять заявку.");
        return;
    }
    db.friends.push(friendship);
    const { error: reqError } = await sb.from("friend_requests").update({ status: "accepted", responded_at: new Date().toISOString() }).eq("id", requestId);
    if (reqError) console.error(reqError);
    db.friendRequests = db.friendRequests.filter(r => r.id !== requestId);
    toast("Теперь вы друзья 🎉");
    createNotification({ userId: otherUserId, type: "friend_accept" });
    recomputeAchievements();
    navigate(currentPage, selectedProfileId);
    updateNavBadges();
}

async function removeFriend(userId) {
    const f = db.friends.find(f => (f.user1 === currentUserId && f.user2 === userId) || (f.user2 === currentUserId && f.user1 === userId));
    if (!f) return;
    const { error } = await sb.from("friendships").delete().eq("id", f.id);
    if (error) {
        toast("Не удалось удалить друга.");
        return;
    }
    db.friends = db.friends.filter(x => x.id !== f.id);
    toast("Пользователь удалён из друзей.");
    navigate(currentPage, selectedProfileId || userId);
}

/* ============================================================
   NOTIFICATIONS
   ============================================================ */

// Writes one notification row for someone ELSE to see later — the same
// client-writes-directly pattern as the rest of this app. Silently
// no-ops on self-actions (e.g. liking your own post) and swallows
// errors, since a failed notification insert shouldn't roll back or
// interrupt the like/comment/request that triggered it.
async function createNotification({ userId, type, postId = null, commentId = null }) {
    if (!userId || userId === currentUserId) return;
    const { error } = await sb.from("bubbles_notifications").insert({
        id: uid("notif"),
        user_id: userId,
        actor_id: currentUserId,
        type,
        post_id: postId,
        comment_id: commentId
    });
    if (error) console.error("❌ Не удалось создать уведомление:", error);
}

/* ------------------------------------------------------------
   PUSH NOTIFICATIONS
   ------------------------------------------------------------
   The actual SENDING of a push (when someone likes/comments/messages
   you while you're not looking) happens server-side, in a Supabase
   Edge Function — see supabase/functions/send-push/. Everything here
   is just the client's half: register the service worker, ask for
   permission, subscribe, and hand Supabase the subscription so that
   function knows where to deliver to.
   ------------------------------------------------------------ */

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function subscribeToPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return; // unsupported browser — just skip, quietly
    if (!window.BUBBLES_VAPID_PUBLIC_KEY) return;
    if (Notification.permission === "denied") return; // they said no once — don't nag every session

    try {
        // Already registered up top, at script load — just wait for it to
        // be active rather than registering (the same URL+scope) again.
        const registration = await navigator.serviceWorker.ready;

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            const permission = await Notification.requestPermission();
            if (permission !== "granted") return;
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(window.BUBBLES_VAPID_PUBLIC_KEY)
            });
        }

        const json = subscription.toJSON();
        // Upsert on endpoint: the SAME browser subscription re-registering
        // (e.g. a different person logging in on a shared device) should
        // just take over the row rather than fail on the unique index.
        const { error } = await sb.from("push_subscriptions").upsert({
            id: uid("push"),
            user_id: currentUserId,
            endpoint: json.endpoint,
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth
        }, { onConflict: "endpoint" });
        if (error) console.error("❌ Не удалось сохранить push-подписку:", error);
    } catch (error) {
        // Notification permission prompts and service worker registration
        // can fail for lots of harmless reasons (iOS Safari outside a
        // installed PWA, permission dismissed, etc.) — never let this
        // break login.
        console.error("Push subscribe failed:", error);
    }
}

function unreadNotificationsCount() {
    return db.notifications.filter(n => !n.readAt).length;
}

// One line of copy + a click target per notification type. Likes and
// comments both just take you back to the post (comments render inline
// under it, so there's no separate page to jump to); friend events go
// to Друзья / the other person's profile.
function notificationLine(n) {
    const actor = getUser(n.actorId);
    const name = escapeHtml(actor?.displayName || actor?.username || "Кто-то");
    switch (n.type) {
        case "friend_request":
            return { text: `${name} отправил(а) заявку в друзья 🫂`, onclick: `navigate('friends')` };
        case "friend_accept":
            return { text: `${name} принял(а) вашу заявку в друзья 🎉`, onclick: `navigate('profile','${n.actorId}')` };
        case "post_like":
            return { text: `${name} оценил(а) ваш пост ❤️`, onclick: `goToPost('${n.postId}')` };
        case "post_comment":
            return { text: `${name} прокомментировал(а) ваш пост 💬`, onclick: `goToPost('${n.postId}')` };
        default:
            return { text: name, onclick: "" };
    }
}

function renderNotificationsPanel() {
    const items = [...db.notifications].sort((a, b) => b.createdAt - a.createdAt);
    return `
        <div class="notif-panel-header">Уведомления</div>
        <div class="notif-panel-list">
            ${
                items.length
                ? items.map(n => {
                    const { text, onclick } = notificationLine(n);
                    const actor = getUser(n.actorId);
                    return `
                        <div class="notif-item${n.readAt ? "" : " unread"}" onclick="${onclick};closeNotificationsPanel();">
                            <img class="mini-avatar" src="${actor?.avatar || defaultAvatar()}">
                            <div class="notif-item-body">
                                <span>${text}</span>
                                <small>${new Date(n.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
                            </div>
                        </div>
                    `;
                }).join("")
                : `<div class="empty notif-empty">Пока ничего нет.</div>`
            }
        </div>
    `;
}

// Opens/closes the bell dropdown and, on open, marks everything read —
// same "clears when you look at it" behaviour as most notification
// bells. stopPropagation keeps the outside-click listener below from
// closing it on the same click that opened it.
function toggleNotificationsPanel(event) {
    event.stopPropagation();
    const panel = document.getElementById("notifPanel");
    if (!panel) return;
    const wasOpen = !panel.classList.contains("hidden");
    if (wasOpen) {
        closeNotificationsPanel();
        return;
    }
    panel.innerHTML = renderNotificationsPanel();
    panel.classList.remove("hidden");
    positionNotificationsPanel(panel);
    markAllNotificationsRead();
}

// The bell isn't the last icon in the topbar (theme toggle + avatar +
// name come after it), so a plain CSS "position:absolute; right:0"
// anchors the panel to the BELL's own right edge, not the screen's —
// on a narrow phone screen there isn't room to its right for a 320px
// panel and it runs off-screen. Switching to position:fixed, measured
// from the button's actual on-screen position and clamped to the
// viewport, keeps it fully visible no matter how narrow the screen is
// or how the surrounding icons shift around.
function positionNotificationsPanel(panel) {
    const btn = document.getElementById("notifBellBtn");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(320, window.innerWidth - margin * 2);
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    panel.style.position = "fixed";
    panel.style.top = (rect.bottom + 10) + "px";
    panel.style.left = left + "px";
    panel.style.right = "auto";
    panel.style.width = width + "px";
    panel.style.maxHeight = Math.min(420, window.innerHeight - rect.bottom - 24) + "px";
}

function closeNotificationsPanel() {
    const panel = document.getElementById("notifPanel");
    if (panel) panel.classList.add("hidden");
}

document.addEventListener("click", closeNotificationsPanel);
window.addEventListener("resize", () => {
    const panel = document.getElementById("notifPanel");
    if (panel && !panel.classList.contains("hidden")) positionNotificationsPanel(panel);
});

async function markAllNotificationsRead() {
    const unread = db.notifications.filter(n => !n.readAt);
    if (!unread.length) return;
    const readAt = new Date().toISOString();
    unread.forEach(n => { n.readAt = Date.parse(readAt); });
    setNavBadge("notifBadge", 0);

    const { error } = await sb
        .from("bubbles_notifications")
        .update({ read_at: readAt })
        .in("id", unread.map(n => n.id))
        .eq("user_id", currentUserId);

    if (error) console.error("❌ Не удалось отметить уведомления прочитанными:", error);
}

// Jumps to the feed and scrolls/highlights one post — used by post_like
// and post_comment notifications. The post might have scrolled off, been
// deleted, or belong to someone whose posts aren't shown here, so this
// fails quietly if the element never shows up.
function goToPost(postId) {
    navigate("feed");
    setTimeout(() => {
        const el = document.querySelector(`[data-bubbles-post-id="${postId}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("post-highlight");
        setTimeout(() => el.classList.remove("post-highlight"), 1600);
    }, 50);
}

/* ============================================================
   MESSAGES
   ============================================================ */

function openChat(userId) {
    selectedChatId = userId;
    selectedMessageImage = null; // a staged photo shouldn't follow you into a different chat
    navigate("messages");
    markChatAsRead(userId);
    joinTypingChannel(userId);
}

async function markChatAsRead(
    userId
) {

    if (
        !currentUserId ||
        !userId
    ) {
        return;
    }


    const unreadMessages =
        db.messages.filter(
            message =>
                message.from ===
                    userId &&

                message.to ===
                    currentUserId &&

                !message.readAt
        );


    if (
        !unreadMessages.length
    ) {

        updateMessagesBadge();

        return;

    }


    const messageIds =
        unreadMessages.map(
            message =>
                message.id
        );


    const readAt =
        new Date()
            .toISOString();


    const {
        error
    } = await sb
        .from("messages")
        .update({
            read_at:
                readAt
        })
        .in(
            "id",
            messageIds
        )
        .eq(
            "receiver_id",
            currentUserId
        );


    if (error) {

        console.error(
            "❌ Ошибка read_at:",
            error
        );

        return;

    }


    /*
     * Обновляем локальную копию.
     */

    db.messages.forEach(
        message => {

            if (
                messageIds.includes(
                    message.id
                )
            ) {

                message.readAt =
                    Date.parse(
                        readAt
                    );

            }

        }
    );


    /*
     * Обновляем оба счётчика.
     */

    updateMessagesBadge();

    // Раньше здесь был renderMessages() — полная перерисовка страницы
    // «Сообщения», включая поле ввода. Это marks-as-read вызывается на
    // КАЖДОЕ входящее сообщение, пока открыт чат (см. setupMessagesRealtime
    // ниже), так что при живой переписке это стирало у собеседника
    // недопечатанный текст и подбрасывало страницу наверх. Галочки
    // "прочитано" всё равно показываются только на СВОИХ отправленных
    // пузырьках (см. messageBubble), а не у того, кто читает, — значит
    // получателю тут вообще ничего перерисовывать не нужно. Обновляем
    // только превью диалога в списке слева (снять бейдж непрочитанных).
    refreshConversationPreview(userId);


    console.log(
        "👁️ Прочитано:",
        messageIds.length
    );

}
function renderMessages(){
    const friends = db.friends.filter(f => f.user1 === currentUserId || f.user2 === currentUserId);
    const users = friends.map(f => getUser(f.user1 === currentUserId ? f.user2 : f.user1)).filter(Boolean);
    if(!selectedChatId && users.length) selectedChatId = users[0].id;

    // Covers BOTH ways a chat ends up open: an explicit click (openChat()
    // already calls this too — the guard above makes that a harmless
    // no-op) and this page just defaulting to the first friend above,
    // which used to skip joinTypingChannel() entirely and left "печатает…"
    // silently never firing until you clicked a conversation row yourself.
    joinTypingChannel(selectedChatId);

    document.getElementById("page").innerHTML = `

        <h1 class="section-title">
            💬 Сообщения
        </h1>

        <div class="encryption-status ok">
            🔒 Сообщения шифруются
        </div>


        <div class="card messages-layout">

            <div class="conversation-list">

                ${
                    users.length
                    ? users.map(renderConversation).join("")
                    : `
                        <div class="empty">
                            Нет друзей для переписки.
                        </div>
                    `
                }

            </div>


            <div class="chat">

                ${
                    selectedChatId
                    ? renderChat(selectedChatId)
                    : `
                        <div class="empty">
                            <div class="empty-icon">
                                💬
                            </div>

                            Выбери друга.
                        </div>
                    `
                }

            </div>

        </div>

    `;

    // Open on the latest messages instead of the top of the conversation.
    // Runs after the innerHTML above is in the DOM, and only matters when
    // a chat is actually open (nothing to scroll on the "выбери друга"
    // placeholder).
    if (selectedChatId) {
        const box = document.getElementById("chatMessages");
        if (box) box.scrollTop = box.scrollHeight;
    }
}

function renderConversation(user) {

    const messages =
        db.messages
            .filter(
                message =>
                    (
                        message.from ===
                            currentUserId &&

                        message.to ===
                            user.id
                    )
                    ||
                    (
                        message.from ===
                            user.id &&

                        message.to ===
                            currentUserId
                    )
            )
            .sort(
                (a, b) =>
                    b.createdAt -
                    a.createdAt
            );


    const lastMessage =
        messages[0];


    const unreadCount =
        getUnreadMessagesFromUser(
            user.id
        );


    return `

        <div
            class="conversation ${
                selectedChatId === user.id
                    ? "active"
                    : ""
            }"
            onclick="openChat('${user.id}')"
        >

            <img
                class="mini-avatar"
                src="${
                    user.avatar ||
                    defaultAvatar()
                }"
            >


            <div
                class="conversation-info"
            >

                <strong>
                    ${escapeHtml(
                        user.displayName ||
                        user.username ||
                        "User"
                    )}
                </strong>


                <small>
                    ${
                        lastMessage
                            ? escapeHtml(messagePreviewText(lastMessage))
                            : "Нет сообщений"
                    }
                </small>

            </div>


            ${
                unreadCount > 0
                    ? `
                        <span
                            class="message-unread-badge conversation-badge"
                        >
                            ${
                                unreadCount > 99
                                    ? "99+"
                                    : unreadCount
                            }
                        </span>
                    `
                    : ""
            }

        </div>

    `;

}

function renderChat(userId){
    const user = getUser(userId);
    const messages = db.messages.filter(m => (m.from === currentUserId && m.to === userId) || (m.from === userId && m.to === currentUserId)).sort((a,b) => a.createdAt - b.createdAt);
    // Каждая переписка теперь всегда шифруется — нет отдельного шага
    // настройки на устройстве, поэтому бейдж больше не зависит от
    // publicKey/isReady, а просто отражает текущую схему.
    const chatEncrypted = true;

    return `

        <div class="chat-header">

            <img
                class="mini-avatar"
                src="${user.avatar || defaultAvatar()}"
                style="width:30px;height:30px;vertical-align:middle;cursor:pointer;"
                onclick="navigate('profile','${user.id}')"
            >

            <div style="display:flex;flex-direction:column;">
                <span style="cursor:pointer;" onclick="navigate('profile','${user.id}')">${escapeHtml(user.displayName)}</span>
                <small id="chatPartnerStatus" class="chat-partner-status">${isUserOnline(user.lastSeen) ? "🟢 Онлайн" : "⚪ Не в сети"}</small>
            </div>

            <span class="chat-encryption-badge" title="${chatEncrypted ? "Сообщения шифруются" : "Сообщения НЕ шифруются"}">${chatEncrypted ? "🔒" : "🔓"}</span>

        </div>


        <div
            class="chat-messages"
            id="chatMessages"
        >

            ${
                messages.length
                ? messages.map(messageBubble).join("")
                : `
                    <div class="empty">
                        Начни переписку.
                    </div>
                `
            }

        </div>

        <div id="typingIndicator" class="typing-indicator hidden">${escapeHtml(user.displayName)} печатает…</div>

        <div id="messageImagePreview" class="message-image-preview ${selectedMessageImage ? "" : "hidden"}">
            <img id="messageImagePreviewImg" src="${selectedMessageImage || ""}">
            <button type="button" class="message-image-remove" onclick="removeMessageImage()" title="Убрать фото">✕</button>
        </div>

        <form
            class="chat-input"
            onsubmit="sendMessage(event,'${userId}')"
        >

            <input
                type="file"
                id="messageImageInput"
                accept="image/*"
                class="hidden"
                onchange="handleMessageImageSelect(event)"
            >

            <button
                type="button"
                class="chat-attach-btn"
                onclick="document.getElementById('messageImageInput').click()"
                title="Прикрепить фото"
            >
                📷
            </button>

            <input
    id="messageInput"
    maxlength="1000"
    autocomplete="off"
    placeholder="Написать сообщение..."
    oninput="handleTyping()"
>

            <button class="primary">
                Отправить
            </button>

        </form>

    `;
}

// One-line preview of a message for places that can't show a full bubble
// (conversation list, the "new message" popup) — handles the shared-post
// marker and photo messages specially instead of dumping raw text.
function messagePreviewText(message){
    const shared = parseSharedPostMessage(message.text);
    if(shared) return shared.caption ? `🫧 ${shared.caption}` : "🫧 Поделился постом";
    if(message.text) return message.text;
    if(message.image) return "📷 Фото";
    return "";
}

function messageBubble(message){
    const mine = message.from === currentUserId;

    // Group the flat reactions list (one row per person) into
    // emoji -> [userIds], so two people reacting with the same emoji show
    // as one pill with a count instead of two separate pills.
    const reactions = message.reactions || [];
    const grouped = new Map();
    reactions.forEach(r => {
        if (!grouped.has(r.emoji)) grouped.set(r.emoji, []);
        grouped.get(r.emoji).push(r.userId);
    });

    const sharedPost = parseSharedPostMessage(message.text);

    return `

        <div class="message ${mine ? "me" : "them"}${message.image ? " has-image" : ""}" data-bubbles-message-id="${message.id}">

            ${message.image ? `<img class="message-image" src="${message.image}" onclick="viewChatImage(this.src)">` : ""}

            ${
                sharedPost
                ? `
                    <div onclick="focusSharedPost('${sharedPost.postId}')" style="cursor:pointer">
                        ${renderSharedPostCard(sharedPost.postId, { clickable: false })}
                    </div>
                    ${sharedPost.caption ? `<div class="shared-post-caption">${escapeHtml(sharedPost.caption)}</div>` : ""}
                  `
                : (message.text ? escapeHtml(message.text) : "")
            }

            <small>
                ${new Date(message.createdAt)
                    .toLocaleTimeString(
                        "ru-RU",
                        {
                            hour:"2-digit",
                            minute:"2-digit"
                        }
                    )}
                ${mine ? `<span class="read-tick ${message.readAt ? "read" : ""}">${message.readAt ? "✓✓" : "✓"}</span>` : ""}
            </small>

            <div class="message-reactions">

                ${
                    [...grouped.entries()].map(([emoji, userIds]) => `
                        <button
                            type="button"
                            class="reaction-pill${userIds.includes(currentUserId) ? " mine" : ""}"
                            onclick="toggleMessageReaction('${message.id}','${emoji}')"
                            title="${userIds.length}"
                        >
                            ${emoji}${userIds.length > 1 ? `<span>${userIds.length}</span>` : ""}
                        </button>
                    `).join("")
                }

                <button
                    type="button"
                    class="reaction-add-btn"
                    onclick="toggleReactionPicker(event,'${message.id}')"
                    title="Добавить реакцию"
                >🙂</button>

                <div class="reaction-picker hidden">
                    ${
                        QUICK_REACTIONS.map(emoji => `
                            <button
                                type="button"
                                onclick="toggleMessageReaction('${message.id}','${emoji}');closeReactionPickers();"
                            >
                                ${emoji}
                            </button>
                        `).join("")
                    }
                </div>

            </div>

        </div>

    `;

}

// Adds/replaces/removes the current user's reaction to one message
// (tapback-style: one emoji per person per message). Optimistic-update-
// then-reconcile, same pattern as toggleLike/toggleCommentLike above.
async function toggleMessageReaction(messageId, emoji) {
    const message = db.messages.find(m => m.id === messageId);
    if (!message) return;
    if (!message.reactions) message.reactions = [];

    const mine = message.reactions.find(r => r.userId === currentUserId);
    const removing = !!mine && mine.emoji === emoji;

    message.reactions = message.reactions.filter(r => r.userId !== currentUserId);
    if (!removing) message.reactions.push({ userId: currentUserId, emoji });
    refreshMessageBubbleInPlace(messageId);

    // Each person only ever writes their OWN row here (message_id, user_id
    // primary key), which RLS can safely allow on either side of the
    // chat — unlike updating the whole message row, which only the
    // sender is allowed to do.
    const { error } = removing
        ? await sb.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", currentUserId)
        : await sb.from("message_reactions").upsert(
            { message_id: messageId, user_id: currentUserId, emoji },
            { onConflict: "message_id,user_id" }
        );

    if (error) {
        console.error(error);
        // roll back
        message.reactions = message.reactions.filter(r => r.userId !== currentUserId);
        if (mine) message.reactions.push(mine);
        refreshMessageBubbleInPlace(messageId);
        toast("Не удалось поставить реакцию.");
    }
}

// Re-renders just one message bubble in place (if its chat is currently
// open), same trick as refreshPostInPlace — keeps scroll position stable.
function refreshMessageBubbleInPlace(messageId) {
    const message = db.messages.find(m => m.id === messageId);
    const el = document.querySelector(`[data-bubbles-message-id="${messageId}"]`);
    if (!message || !el) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = messageBubble(message).trim();
    el.replaceWith(wrapper.firstElementChild);
}

// Opens the quick-emoji picker for one bubble, closing any other picker
// that was already open. stopPropagation keeps the outside-click listener
// (below) from immediately closing the one we just opened.
function toggleReactionPicker(event, messageId) {
    event.stopPropagation();
    const bubble = document.querySelector(`[data-bubbles-message-id="${messageId}"]`);
    const picker = bubble?.querySelector(".reaction-picker");
    if (!picker) return;
    const wasOpen = !picker.classList.contains("hidden");
    closeReactionPickers();
    if (!wasOpen) picker.classList.remove("hidden");
}

function closeReactionPickers() {
    document.querySelectorAll(".reaction-picker").forEach(el => el.classList.add("hidden"));
}

// Clicking anywhere outside an open picker closes it — same idea as
// dismissing any other popover/menu.
document.addEventListener("click", closeReactionPickers);

// Resizes/stages a photo picked from the chat's attach button. Stored as a
// data URL, same trick used for post images, so no Storage bucket is needed.
async function handleMessageImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
        toast("Можно прикрепить только изображение.");
        event.target.value = "";
        return;
    }
    if (file.size > 15 * 1024 * 1024) {
        toast("Изображение слишком большое. Максимум 15 МБ.");
        event.target.value = "";
        return;
    }
    try { selectedMessageImage = await resizeImageFile(file, 1280); }
    catch (e) { console.error(e); toast("Не удалось обработать изображение."); event.target.value = ""; return; }
    event.target.value = ""; // so picking the same file again still fires onchange
    const box = document.getElementById("messageImagePreview");
    const img = document.getElementById("messageImagePreviewImg");
    if (box && img) {
        img.src = selectedMessageImage;
        box.classList.remove("hidden");
    }
}

function removeMessageImage() {
    selectedMessageImage = null;
    const box = document.getElementById("messageImagePreview");
    if (box) box.classList.add("hidden");
}

// Tiny full-screen viewer for tapping a photo in the chat — closes on click.
function viewChatImage(src) {
    const overlay = document.createElement("div");
    overlay.className = "image-viewer-overlay";
    overlay.onclick = () => overlay.remove();
    overlay.innerHTML = `<img src="${src}">`;
    document.body.appendChild(overlay);
}

/* ------------------------------------------------------------
   BUBBLE POP — easter egg mini-game
   ------------------------------------------------------------
   Tap the "bubbles" wordmark in the top bar 5 times quickly to
   open it. 30 seconds, bubbles float up from the bottom of the
   screen, tap to pop for points (small bubbles are worth more —
   they're harder to hit). High score is kept per-browser in
   localStorage, no server round trip needed for something this
   throwaway-fun.
   ------------------------------------------------------------ */

let logoTapTimes = [];
function handleLogoTap() {
    navigate("feed");

    const now = Date.now();
    logoTapTimes = logoTapTimes.filter(t => now - t < 1400);
    logoTapTimes.push(now);
    if (logoTapTimes.length >= 5) {
        logoTapTimes = [];
        openBubblePop();
    }
}

function bubblePopHighScoreKey() {
    return "bubbles-pop-highscore-" + (currentUserId || "guest");
}

let bubblePopState = null; // { spawnTimer, countdownTimer, timeLeft, score, ended }

function openBubblePop() {
    if (document.querySelector(".bubble-pop-overlay")) return;

    const overlay = document.createElement("div");
    overlay.className = "bubble-pop-overlay";
    overlay.innerHTML = `
        <div class="bubble-pop-header">
            <button class="bubble-pop-close" onclick="closeBubblePop()" title="Закрыть">✕</button>
            <div class="bubble-pop-title">🫧 Лови пузыри!</div>
            <div class="bubble-pop-score">⭐ <span id="bubblePopScore">0</span></div>
            <div class="bubble-pop-timer">⏱️ <span id="bubblePopTimer">30</span>с</div>
        </div>
        <div class="bubble-pop-field" id="bubblePopField"></div>
    `;
    document.body.appendChild(overlay);

    bubblePopState = { score: 0, timeLeft: 30, ended: false, spawnTimer: null, countdownTimer: null };

    bubblePopState.spawnTimer = setInterval(spawnPopBubble, 450);
    bubblePopState.countdownTimer = setInterval(() => {
        bubblePopState.timeLeft--;
        const timerEl = document.getElementById("bubblePopTimer");
        if (timerEl) timerEl.textContent = bubblePopState.timeLeft;
        if (bubblePopState.timeLeft <= 0) endBubblePop();
    }, 1000);

    // A couple right away so the field doesn't feel empty on open.
    spawnPopBubble();
    spawnPopBubble();
}

function spawnPopBubble() {
    const field = document.getElementById("bubblePopField");
    if (!field || !bubblePopState || bubblePopState.ended) return;

    const size = 34 + Math.random() * 58; // smaller = worth more, harder to hit
    const points = Math.max(1, Math.round(90 / size));
    const duration = 3.2 + Math.random() * 2.2;
    const left = Math.random() * 90;
    const drift = (Math.random() * 60 - 30) + "px";

    const bubble = document.createElement("div");
    bubble.className = "pop-bubble";
    bubble.style.width = bubble.style.height = size + "px";
    bubble.style.left = left + "%";
    bubble.style.setProperty("--pop-drift", drift);
    bubble.style.animationDuration = duration + "s";
    bubble.onclick = (e) => {
        e.stopPropagation();
        popBubble(bubble, points);
    };
    bubble.addEventListener("animationend", () => bubble.remove());

    field.appendChild(bubble);
}

function popBubble(bubble, points) {
    if (!bubblePopState || bubblePopState.ended || bubble.classList.contains("popped")) return;
    bubble.classList.add("popped");
    bubblePopState.score += points;
    const scoreEl = document.getElementById("bubblePopScore");
    if (scoreEl) scoreEl.textContent = bubblePopState.score;
    setTimeout(() => bubble.remove(), 300);
}

function endBubblePop() {
    if (!bubblePopState || bubblePopState.ended) return;
    bubblePopState.ended = true;
    clearInterval(bubblePopState.spawnTimer);
    clearInterval(bubblePopState.countdownTimer);

    const score = bubblePopState.score;
    const highKey = bubblePopHighScoreKey();
    const prevHigh = parseInt(localStorage.getItem(highKey) || "0", 10);
    const isNewHigh = score > prevHigh;
    if (isNewHigh) localStorage.setItem(highKey, String(score));

    const field = document.getElementById("bubblePopField");
    if (!field) return;
    const result = document.createElement("div");
    result.className = "bubble-pop-result";
    result.innerHTML = `
        <div class="bubble-pop-result-card">
            <h2>${isNewHigh ? "🎉 Новый рекорд!" : "Время вышло!"}</h2>
            <p>Очки: <b>${score}</b></p>
            <p>Рекорд: <b>${Math.max(score, prevHigh)}</b></p>
            <button class="primary" onclick="restartBubblePop()">Ещё раз</button>
        </div>
    `;
    field.appendChild(result);
}

function restartBubblePop() {
    closeBubblePop();
    openBubblePop();
}

function closeBubblePop() {
    if (bubblePopState) {
        clearInterval(bubblePopState.spawnTimer);
        clearInterval(bubblePopState.countdownTimer);
        bubblePopState = null;
    }
    const overlay = document.querySelector(".bubble-pop-overlay");
    if (overlay) overlay.remove();
}

/* ------------------------------------------------------------
   TYPING INDICATOR (Supabase Realtime broadcast — no DB table)
   ------------------------------------------------------------ */

let typingTimer = null;

function chatChannelName(userId) {
    return "bubbles-chat-" + [currentUserId, userId].sort().join("-");
}

function joinTypingChannel(partnerId) {
    // Already listening for this exact partner — re-subscribing on every
    // render (renderMessages() calls this too, see below) would just
    // needlessly tear down and rebuild the same realtime channel.
    if (typingChannel && typingChannelPartnerId === partnerId) return;
    if (typingChannel) { sb.removeChannel(typingChannel); typingChannel = null; }
    typingChannelPartnerId = partnerId || null;
    if (!partnerId || !currentUserId) return;
    typingChannel = sb.channel(chatChannelName(partnerId))
        .on("broadcast", { event: "typing" }, (payload) => {
            if (payload.payload?.from === partnerId) showTypingIndicator();
        })
        .on("broadcast", { event: "stop_typing" }, (payload) => {
            if (payload.payload?.from === partnerId) hideTypingIndicator();
        })
        .subscribe();
}

function showTypingIndicator() {
    const el = document.getElementById("typingIndicator");
    if (el) el.classList.remove("hidden");
}

function hideTypingIndicator() {
    const el = document.getElementById("typingIndicator");
    if (el) el.classList.add("hidden");
}

function handleTyping() {
    if (typingChannel && selectedChatId) {
        typingChannel.send({ type: "broadcast", event: "typing", payload: { from: currentUserId } });
    }
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 2000);
}
/* ============================================================
   BUBBLES — NEW MESSAGE POPUP
   ============================================================ */

function showNewMessagePopup(message) {

    /*
     * Не показываем popup для своих сообщений.
     */

    if (
        !message ||
        message.to !== currentUserId
    ) {
        return;
    }


    /*
     * Если пользователь уже находится
     * именно в этом чате — popup не нужен.
     */

    const currentChat =
        (
            typeof selectedChatId !==
            "undefined" &&

            selectedChatId &&
            message.from ===
                selectedChatId
        );


    if (
        currentPage === "messages" &&
        currentChat
    ) {
        return;
    }


    /*
     * Удаляем предыдущий popup,
     * если новый пришёл слишком быстро.
     */

    const oldPopup =
        document.querySelector(
            ".bubbles-message-popup"
        );


    if (oldPopup) {

        oldPopup.classList.remove(
            "show"
        );

        setTimeout(
            () => oldPopup.remove(),
            180
        );

    }


    /*
     * Пытаемся найти отправителя.
     */

    let sender = null;


    if (
        Array.isArray(
            db.users
        )
    ) {

        sender =
            db.users.find(
                user =>
                    user.id ===
                    message.from
            );

    }


    const senderName =
        sender?.displayName ||
        sender?.username ||
        "Новое сообщение";


    const avatar =
        sender?.avatar ||
        (
            typeof defaultAvatar ===
            "function"
                ? defaultAvatar()
                : ""
        );


    /*
     * Ограничиваем текст,
     * чтобы огромные сообщения
     * не раздували popup.
     */

    let messageText =
        messagePreviewText(message) ||
        "Новое сообщение";


    if (
        messageText.length > 80
    ) {

        messageText =
            messageText.substring(
                0,
                80
            ) + "...";

    }


    /*
     * Создаём popup.
     */

    const popup =
        document.createElement(
            "div"
        );


    popup.className =
        "bubbles-message-popup";


    popup.innerHTML = `

        <div
            class="bubbles-popup-avatar"
        >

            <img
                src="${avatar}"
                alt=""
            >

        </div>


        <div
            class="bubbles-popup-content"
        >

            <div
                class="bubbles-popup-title"
            >

                <span>
                    ${escapeHtml(
                        senderName
                    )}
                </span>

                <span
                    class="bubbles-popup-message-icon"
                >
                    💬
                </span>

            </div>


            <div
                class="bubbles-popup-text"
            >
                ${escapeHtml(
                    messageText
                )}
            </div>

        </div>


        <button
            class="bubbles-popup-close"
            type="button"
            aria-label="Закрыть"
        >
            ×
        </button>

    `;


    document.body.appendChild(
        popup
    );


    /*
     * Клик по popup открывает чат.
     */

    popup.addEventListener(
        "click",
        function (event) {

            /*
             * Кнопка закрытия
             * не должна открывать чат.
             */

            if (
                event.target.closest(
                    ".bubbles-popup-close"
                )
            ) {

                return;
            }


            /*
             * Закрываем popup.

             */

            closeMessagePopup(
                popup
            );


            /*
             * Открываем чат.
             */

            if (
                typeof openChat ===
                "function"
            ) {

                openChat(
                    message.from
                );

            }

        }
    );


    /*
     * Отдельно обрабатываем крестик.
     */

    const closeButton =
        popup.querySelector(
            ".bubbles-popup-close"
        );


    if (closeButton) {

        closeButton.addEventListener(
            "click",
            function () {

                closeMessagePopup(
                    popup
                );

            }
        );

    }


    /*
     * Запускаем появление
     * на следующем animation frame.
     */

    requestAnimationFrame(
        function () {

            popup.classList.add(
                "show"
            );

        }
    );


    /*
     * Автоматически скрываем
     * через 5 секунд.
     */

    popup._bubblesTimeout =
        setTimeout(
            function () {

                closeMessagePopup(
                    popup
                );

            },
            5000
        );

}


/* ============================================================
   CLOSE POPUP
   ============================================================ */

function closeMessagePopup(
    popup
) {

    if (!popup) {
        return;
    }


    if (
        popup._bubblesTimeout
    ) {

        clearTimeout(
            popup._bubblesTimeout
        );

    }


    popup.classList.remove(
        "show"
    );


    setTimeout(
        function () {

            if (
                popup &&
                popup.parentNode
            ) {

                popup.remove();

            }

        },
        220
    );

}


/* ============================================================
   GLOBAL ACCESS
   ============================================================ */

window.showNewMessagePopup =
    showNewMessagePopup;

window.closeMessagePopup =
    closeMessagePopup;

function stopTyping() {
    if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimer = null;
    }
    if (typingChannel && selectedChatId) {
        typingChannel.send({ type: "broadcast", event: "stop_typing", payload: { from: currentUserId } });
    }
}

// Appends one message bubble to the open chat without redrawing the whole
// conversation, and updates that conversation's preview text in the list.
function appendMessageToChat(message, partnerId) {
    const box = document.getElementById("chatMessages");
    if (box && selectedChatId === partnerId && currentPage === "messages") {
        // Guards against double-appending the same bubble — e.g. the
        // sender's own realtime echo of a message they already appended
        // optimistically in sendMessage(), or the same INSERT arriving
        // twice on a flaky connection.
        if (!box.querySelector(`[data-bubbles-message-id="${message.id}"]`)) {
            const empty = box.querySelector(".empty");
            if (empty) empty.remove();
            const wrapper = document.createElement("div");
            wrapper.innerHTML = messageBubble(message).trim();
            box.appendChild(wrapper.firstElementChild);
            box.scrollTop = box.scrollHeight;
        }
    }
    refreshConversationPreview(partnerId);
}

function refreshConversationPreview(partnerId) {
    const row = document.querySelector(`.conversation[onclick="openChat('${partnerId}')"]`);
    const user = getUser(partnerId);
    if (!row || !user) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderConversation(user).trim();
    row.replaceWith(wrapper.firstElementChild);
}

// Builds an encrypted (or, if the key can't be fetched right now,
// plaintext-fallback) row ready to insert into `messages`. Shared by
// sendMessage (the chat composer) and shareToChat (sharing a post into a
// conversation that might not even be open) so both go through the exact
// same encryption path rather than two copies that could drift apart.
async function buildEncryptedMessageRow(id, toUserId, text, image, createdAtIso){
    const row = {
        id,
        sender_id: currentUserId,
        receiver_id: toUserId,
        created_at: createdAtIso
    };

    let sharedKey = null;
    try {
        sharedKey = await BubblesCrypto.getConversationKey(currentUserId, toUserId);
    } catch (e) {
        console.error(e);
    }

    if (sharedKey) {
        row.encrypted = true;
        if (text) {
            const enc = await BubblesCrypto.encryptString(sharedKey, text);
            row.text = enc.ciphertext;
            row.iv = enc.iv;
        } else {
            row.text = "";
        }
        if (image) {
            const encImg = await BubblesCrypto.encryptString(sharedKey, image);
            row.image = encImg.ciphertext;
            row.img_iv = encImg.iv;
        } else {
            row.image = "";
        }
    } else {
        // Не удалось получить/создать ключ переписки прямо сейчас — не
        // блокируем отправку, отправляем открытым текстом, как раньше.
        row.encrypted = false;
        row.text = text;
        row.image = image;
    }

    return row;
}

async function sendMessage(event, userId) {
    event.preventDefault();
    stopTyping();
    const input = document.getElementById("messageInput");
    const text = input.value.trim();
    const image = selectedMessageImage || "";
    if (!text && !image)
        return;
    input.value = "";
    removeMessageImage();
    // Shown locally right away in plaintext — we already know the plaintext,
    // no need to round-trip through decryption for our own optimistic bubble.
    const message = { id: uid("message"), from: currentUserId, to: userId, text, image, createdAt: Date.now(), readAt: null, reactions: [] };
    db.messages.push(message);
    appendMessageToChat(message, userId);

    const row = await buildEncryptedMessageRow(message.id, userId, text, image, new Date(message.createdAt).toISOString());

    const { error } = await sb.from("messages").insert(row);
    if (error) {
        console.error(error);
        db.messages = db.messages.filter(m => m.id !== message.id);
        toast("Не удалось отправить сообщение.");
        const bubble = document.querySelector(`[data-bubbles-message-id="${message.id}"]`);
        if (bubble) bubble.remove();
        return;
    }
    recomputeAchievements();
}

/* ============================================================
   MUSIC
   ============================================================ */

// The list currently shown in the Music tab, given the active tab + search —
// this is also the "queue" that next/prev/autoplay walks through.
function getFilteredMusicList() {
    let list = [...db.music];
    if (musicTab === "mine") list = list.filter(m => m.authorId === currentUserId || mySavedMusicIds.has(m.id));
    const query = musicSearchQuery.trim().toLowerCase();
    if (query) {
        list = list.filter(m => {
            const author = getUser(m.authorId);
            return m.title.toLowerCase().includes(query)
                || (m.artist || "").toLowerCase().includes(query)
                || (author?.username || "").toLowerCase().includes(query)
                || (author?.displayName || "").toLowerCase().includes(query);
        });
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
}

function renderMusic() {
    const music = getFilteredMusicList();
    musicQueue = music.map(m => m.id);

    document.getElementById("page").innerHTML = `
        <h1 class="section-title">🎵 Музыка</h1>

        <div class="music-tabs">
            <button class="music-tab-btn ${musicTab === "mine" ? "active" : ""}" onclick="setMusicTab('mine')">Моя музыка</button>
            <button class="music-tab-btn ${musicTab === "all" ? "active" : ""}" onclick="setMusicTab('all')">Вся музыка</button>
        </div>

        <div class="search music-search">
            <input id="musicSearchInput" placeholder="Найти трек, артиста или автора…" value="${escapeHtml(musicSearchQuery)}" oninput="setMusicSearch(this.value)">
        </div>

        ${
            musicTab === "mine"
            ? `
                <div class="card">
                    <h3>Опубликовать музыку</h3>
                    <div class="form-group"><label>Название трека</label><input id="musicTitle" maxlength="80" placeholder="Название"></div>
                    <div class="form-group"><label>Имя артиста</label><input id="musicArtist" maxlength="80" placeholder="Имя Артиста"></div>
                    <div class="form-group"><label>Обложка</label><input id="musicCover" type="file" accept="image/png,image/jpeg,image/webp"></div>
                    <div class="form-group"><label>MP3-файл — максимум 15 МБ</label><input id="musicFile" type="file" accept=".mp3,audio/mpeg"></div>
                    <button class="primary" onclick="uploadMusic()">🎵 Опубликовать MP3</button>
                    <p style="color:#7899a7;font-size:12px;margin-bottom:0">MP3 и обложка сохраняются в Supabase Storage. После публикации трек сразу появляется здесь.</p>
                </div>
            `
            : ""
        }

        <label class="autoplay-toggle">
            <input type="checkbox" ${musicAutoplay ? "checked" : ""} onchange="setMusicAutoplay(this.checked)">
            Автоматически включать следующий трек
        </label>

        ${
            music.length
            ? music.map(renderMusicCard).join("")
            : emptyState("🎵", musicTab === "mine" ? "Здесь пока пусто" : "Ничего не найдено", musicTab === "mine" ? "Опубликуй свой трек выше или добавь чужой из «Всей музыки»." : "Попробуй другой запрос.")
        }
    `;
}

function setMusicTab(tab) {
    musicTab = tab;
    renderMusic();
}

function setMusicSearch(value) {
    musicSearchQuery = value;
    renderMusic();
    // Keep focus + caret in the search box after the re-render.
    const input = document.getElementById("musicSearchInput");
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

function setMusicAutoplay(value) {
    musicAutoplay = value;
}

function renderMusicCard(music) {
    const author = getUser(music.authorId);
    const isPlaying = currentlyPlayingMusicId === music.id;
    const isMine = music.authorId === currentUserId;
    const isSaved = mySavedMusicIds.has(music.id);
    return `
        <div class="music-card ${isPlaying ? "playing" : ""}" id="music-${music.id}">
            <div class="music-row">
                <img class="music-cover" src="${music.cover || defaultMusicCover()}">
                <div class="music-info">
                    <div class="music-title">${escapeHtml(music.title)}</div>
                    <div class="music-artist">${escapeHtml(music.artist || "Unknown Artist")}</div>
                    <div class="music-artist">@${escapeHtml(author?.username || "unknown")}</div>
                </div>
                <button onclick="playMusic('${music.id}')" title="Слушать">${isPlaying ? "⏸️" : "▶️"}</button>
                ${
                    isMine
                    ? `<button onclick="deleteMusic('${music.id}')" title="Удалить">🗑️</button>`
                    : `<button class="save-track-btn ${isSaved ? "saved" : ""}" onclick="toggleMusicSave('${music.id}')" title="${isSaved ? "Убрать из моей музыки" : "Добавить в мою музыку"}">${isSaved ? "✓" : "➕"}</button>`
                }
                ${
                    !isMine && isAdmin()
                    ? `<button onclick="deleteMusic('${music.id}')" title="Удалить (админ)">🗑️</button>`
                    : ""
                }
            </div>
        </div>
    `;
}

async function toggleMusicSave(musicId) {
    const wasSaved = mySavedMusicIds.has(musicId);
    if (wasSaved) mySavedMusicIds.delete(musicId); else mySavedMusicIds.add(musicId);

    const card = document.getElementById("music-" + musicId);
    if (card) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = renderMusicCard(db.music.find(m => m.id === musicId)).trim();
        card.replaceWith(wrapper.firstElementChild);
    }
    // If we're looking at "Моя музыка", a save/unsave changes which tracks
    // belong in the list, so that tab needs a fuller refresh.
    if (musicTab === "mine") renderMusic();

    const { error } = wasSaved
        ? await sb.from("music_saves").delete().eq("music_id", musicId).eq("user_id", currentUserId)
        : await sb.from("music_saves").insert({ music_id: musicId, user_id: currentUserId });

    if (error) {
        console.error(error);
        if (wasSaved) mySavedMusicIds.add(musicId); else mySavedMusicIds.delete(musicId);
        toast("Не удалось обновить мою музыку.");
        if (currentPage === "music") renderMusic();
    } else if (!wasSaved) {
        recomputeAchievements();
    }
}

async function uploadMusic() {
    const title = document.getElementById("musicTitle").value.trim();
    const artist = document.getElementById("musicArtist").value.trim();
    const audioFile = document.getElementById("musicFile").files[0];
    const coverFile = document.getElementById("musicCover").files[0];
    if (!title) {
        toast("Укажи название трека.");
        return;
    }
    if (!artist) {
        toast("Укажи имя артиста.");
        return;
    }
    if (!audioFile) {
        toast("Выбери MP3-файл.");
        return;
    }
    if (audioFile.size > MAX_MUSIC_SIZE) {
        toast("MP3 слишком большой. Максимум — 15 МБ.");
        return;
    }
    const isMP3 = audioFile.type === "audio/mpeg" || audioFile.name.toLowerCase().endsWith(".mp3");
    if (!isMP3) {
        toast("Можно загружать только MP3.");
        return;
    }
    if (coverFile && !coverFile.type.startsWith("image/")) {
        toast("Обложка должна быть изображением.");
        return;
    }
    if (coverFile && coverFile.size > MAX_COVER_SIZE) {
        toast("Обложка слишком большая. Максимум 5 МБ.");
        return;
    }
    const musicId = uid("music");
    const audioPath = `${currentUserId}/${musicId}.mp3`;
    const coverPath = coverFile ? `${currentUserId}/${musicId}-cover.${(coverFile.name.split(".").pop() || "jpg").toLowerCase()}` : "";
    try {
        toast("Загружаю трек в Supabase…");
        let result = await sb.storage.from(MUSIC_BUCKET).upload(audioPath, audioFile, { contentType: "audio/mpeg", upsert: false });
        if (result.error)
            throw result.error;
        let audioUrl = sb.storage.from(MUSIC_BUCKET).getPublicUrl(audioPath).data.publicUrl;
        let coverUrl = "";
        if (coverFile) {
            result = await sb.storage.from(MUSIC_BUCKET).upload(coverPath, coverFile, { contentType: coverFile.type, upsert: false });
            if (result.error)
                throw result.error;
            coverUrl = sb.storage.from(MUSIC_BUCKET).getPublicUrl(coverPath).data.publicUrl;
        }
        const row = { id: musicId, author_id: currentUserId, title, artist, cover_url: coverUrl, audio_url: audioUrl, audio_path: audioPath, cover_path: coverPath, created_at: new Date().toISOString() };
        const { error } = await sb.from("music").insert(row);
        if (error)
            throw error;
        db.music.unshift(rowToMusic(row));
        document.getElementById("musicTitle").value = "";
        document.getElementById("musicArtist").value = "";
        document.getElementById("musicFile").value = "";
        document.getElementById("musicCover").value = "";
        toast("Трек опубликован 🎵");
        recomputeAchievements();
        renderMusic();
    }
    catch (error) {
        console.error(error);
        try {
            await sb.storage.from(MUSIC_BUCKET).remove([audioPath, coverPath].filter(Boolean));
        }
        catch { }
        toast("Не удалось загрузить трек. Проверь Storage и RLS.");
    }
}

function refreshMusicCardPlayState(musicId) {
    document.querySelectorAll(".music-card").forEach(card => card.classList.remove("playing"));
    document.querySelectorAll(".music-card button[title=\"Слушать\"], .music-card button[title=\"Пауза\"]").forEach(btn => btn.textContent = "▶️");
    if (!musicId) return;
    const card = document.getElementById("music-" + musicId);
    if (card) {
        card.classList.add("playing");
        const btn = card.querySelector(".music-row > button");
        if (btn) btn.textContent = "⏸️";
    }
}

async function playMusic(musicId){
    const audio = document.getElementById("globalAudio");

    // Tapping the currently-playing track again just pauses/resumes it.
    if (currentlyPlayingMusicId === musicId) {
        if (audio.paused) { try { await audio.play(); } catch {} }
        else audio.pause();
        refreshMusicCardPlayState(audio.paused ? null : musicId);
        return;
    }

    const music = db.music.find(m => m.id === musicId);
    if(!music){ toast("Трек не найден."); return; }
    let url = music.audioUrl || "";
    if(!url && music.audioPath) url = sb.storage.from(MUSIC_BUCKET).getPublicUrl(music.audioPath).data.publicUrl;
    if(!url){ toast("Аудиофайл отсутствует."); return; }

    currentlyPlayingMusicId = musicId;
    audio.src = url;
    document.getElementById("globalPlayerCover").src = music.cover || defaultMusicCover();
    document.getElementById("globalPlayerTitle").textContent = music.title;
    document.getElementById("globalPlayerArtist").textContent = music.artist || "Unknown Artist";
    document.getElementById("globalPlayer").classList.remove("hidden");
    setListening(music.title, music.artist || "Unknown Artist");
    refreshMusicCardPlayState(musicId);

    // If this track isn't part of the currently-viewed list (e.g. played
    // from a profile page), fall back to a queue of just this one track.
    if (!musicQueue.includes(musicId)) musicQueue = [musicId];

    try{ await audio.play(); }catch(error){ console.log("Браузер ожидает действие пользователя.",error); }
}

function playAdjacentTrack(direction) {
    if (!musicQueue.length) return;
    const index = musicQueue.indexOf(currentlyPlayingMusicId);
    const nextIndex = index === -1 ? 0 : (index + direction + musicQueue.length) % musicQueue.length;
    playMusic(musicQueue[nextIndex]);
}

function playNextTrack() { playAdjacentTrack(1); }
function playPrevTrack() { playAdjacentTrack(-1); }

function closeMusicPlayer(){
    const audio = document.getElementById("globalAudio");
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    currentlyPlayingMusicId = null;
    refreshMusicCardPlayState(null);
    document.getElementById("globalPlayer").classList.add("hidden");
    setListening("", "");
}

async function setListening(track, artist){
    if(!currentUserId) return;
    try{
        const {error} = await sb.from("profiles").update({current_track:track,current_artist:artist}).eq("id",currentUserId);
        if(error) throw error;
        const me = getCurrentUser();
        if(me){ me.currentTrack = track; me.currentArtist = artist; }
    }catch(error){
        console.error("Не удалось обновить статус прослушивания:",error);
    }
}

async function deleteMusic(id) {
    const music = db.music.find(m => m.id === id);
    if (!music || (music.authorId !== currentUserId && !isAdmin()))
        return;
    if (!confirm(music.authorId === currentUserId ? "Удалить этот трек?" : "Удалить этот трек как администратор?"))
        return;
    if (currentlyPlayingMusicId === id)
        closeMusicPlayer();
    const { error } = await sb.from("music").delete().eq("id", id);
    if (error) {
        console.error(error);
        toast("Не удалось удалить трек.");
        return;
    }
    const paths = [music.audioPath, music.coverPath].filter(Boolean);
    if (paths.length)
        await sb.storage.from(MUSIC_BUCKET).remove(paths);
    db.music = db.music.filter(m => m.id !== id);
    toast("Трек удалён.");
    renderMusic();
}

/* ============================================================
   ADMIN / MODERATION
   ------------------------------------------------------------
   No standalone "Админ" page any more. Everything lives on the
   profile page:
     - On someone ELSE's profile, an admin sees a small "🛡️
       Модерация" panel with make/revoke-admin and ban/unban.
     - On YOUR OWN profile, if you're an admin, you instead see
       the moderation queue: pending reports on posts, comments
       and profiles, with buttons to ban the reported person,
       delete the reported content, or dismiss the report.
   ============================================================ */

// Rendered inside renderProfile() for any profile that ISN'T your own,
// only if you're an admin looking at a non-admin-viewing-themselves case.
function adminProfileControls(user){
    if (!isAdmin() || user.id === currentUserId) return "";
    return `
        <div class="card" style="margin-top:14px;">
            <h3 style="margin-top:0;">🛡️ Модерация</h3>
            <div style="opacity:.7;font-size:14px;margin-bottom:10px;">
                ${user.role === "admin" ? "🛡️ Администратор" : "Обычный пользователь"}
                ${user.banned ? ` · 🚫 забанен${user.banReason ? ": " + escapeHtml(user.banReason) : ""}` : ""}
                ${user.customStatusTitle ? ` · статус: ${escapeHtml(user.customStatusIcon || "🌟")} ${escapeHtml(user.customStatusTitle)}` : ""}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${
                    user.role === "admin"
                    ? `<button class="secondary" onclick="setUserRole('${user.id}',false)">Снять права админа</button>`
                    : `<button class="secondary" onclick="setUserRole('${user.id}',true)">Сделать админом</button>`
                }
                ${
                    user.banned
                    ? `<button class="secondary" onclick="setUserBanned('${user.id}',false)">Разбанить</button>`
                    : `<button class="danger" onclick="setUserBanned('${user.id}',true)">Забанить</button>`
                }
                <button class="secondary" onclick="setCustomStatus('${user.id}')">
                    ${user.customStatusTitle ? "✏️ Изменить статус" : "🌟 Назначить статус"}
                </button>
                ${
                    user.customStatusTitle
                    ? `<button class="secondary" onclick="clearCustomStatus('${user.id}')">Сбросить статус</button>`
                    : ""
                }
            </div>
        </div>
    `;
}

// Overrides the auto-computed achievement tier outright — only an admin
// can call this (checked here AND enforced again at the DB level by the
// protect_profile_role_columns trigger, in case this ever gets called
// from somewhere that skips the UI check). An empty title clears it,
// same as clearCustomStatus below.
async function setCustomStatus(userId) {
    if (!isAdmin()) return;
    const user = getUser(userId);
    if (!user) return;
    const title = (prompt(`Статус для ${user.displayName} (например «Королева пузырей»):`, user.customStatusTitle || "") || "").trim();
    if (!title) return;
    const icon = (prompt("Эмодзи для статуса (необязательно):", user.customStatusIcon || "🌟") || "🌟").trim();
    const { error } = await sb.from("profiles").update({ custom_status_title: title, custom_status_icon: icon }).eq("id", userId);
    if (error) { console.error(error); toast("Не удалось назначить статус."); return; }
    user.customStatusTitle = title;
    user.customStatusIcon = icon;
    toast(`Статус «${icon} ${title}» назначен ${user.displayName}.`);
    renderApp();
}

async function clearCustomStatus(userId) {
    if (!isAdmin()) return;
    const user = getUser(userId);
    if (!user) return;
    if (!confirm(`Сбросить статус у ${user.displayName} и вернуть автоматический?`)) return;
    const { error } = await sb.from("profiles").update({ custom_status_title: null, custom_status_icon: null }).eq("id", userId);
    if (error) { console.error(error); toast("Не удалось сбросить статус."); return; }
    user.customStatusTitle = "";
    user.customStatusIcon = "";
    toast("Статус сброшен.");
    renderApp();
}

async function setUserRole(userId, makeAdmin) {
    if (!isAdmin()) return;
    const user = getUser(userId);
    if (!user) return;
    const role = makeAdmin ? "admin" : "user";
    if (!confirm(makeAdmin ? `Выдать права администратора ${user.displayName}?` : `Снять права администратора у ${user.displayName}?`))
        return;
    const { error } = await sb.from("profiles").update({ role }).eq("id", userId);
    if (error) {
        console.error(error);
        toast("Не удалось изменить права.");
        return;
    }
    user.role = role;
    toast(makeAdmin ? "Права администратора выданы." : "Права администратора сняты.");
    renderApp();
}

async function setUserBanned(userId, banned) {
    if (!isAdmin()) return;
    const user = getUser(userId);
    if (!user) return;
    let reason = user.banReason || "";
    if (banned) {
        const input = prompt(`Причина бана для ${user.displayName} (необязательно):`, reason);
        if (input === null) return; // cancelled
        reason = input.trim();
    } else {
        if (!confirm(`Разбанить ${user.displayName}?`)) return;
        reason = "";
    }
    const { error } = await sb.from("profiles").update({ banned, ban_reason: reason }).eq("id", userId);
    if (error) {
        console.error(error);
        toast("Не удалось изменить статус бана.");
        return;
    }
    user.banned = banned;
    user.banReason = reason;

    // Banning (or unbanning) someone resolves every pending report against
    // them in one go — the admin came here BECAUSE of a report, most of
    // the time, so there's no reason to make them dismiss it separately too.
    const affectedIds = db.reports.filter(r => r.targetUserId === userId && r.status === "pending").map(r => r.id);
    if (affectedIds.length) {
        const { error: reportsError } = await sb.from("reports")
            .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: currentUserId })
            .in("id", affectedIds);
        if (!reportsError) db.reports.forEach(r => { if (affectedIds.includes(r.id)) r.status = "resolved"; });
    }

    toast(banned ? "Пользователь забанен." : "Пользователь разбанен.");
    renderApp();
}

/* ------------------------------------------------------------
   REPORTS (жалобы)
   ------------------------------------------------------------ */

function pendingReports() {
    return db.reports.filter(r => r.status === "pending").sort((a,b) => b.createdAt - a.createdAt);
}

// Shared insert used by reportPost/reportComment/reportProfile below.
async function submitReport(targetType, targetId, targetUserId, promptLabel) {
    if (!currentUserId) return;
    if (targetUserId === currentUserId) {
        toast("Нельзя пожаловаться на себя.");
        return;
    }
    const input = prompt(`Почему ты жалуешься ${promptLabel}? (необязательно)`, "");
    if (input === null) return; // cancelled
    const { error } = await sb.from("reports").insert({
        id: uid("report"),
        reporter_id: currentUserId,
        target_type: targetType,
        target_id: targetId,
        target_user_id: targetUserId,
        reason: input.trim()
    });
    if (error) {
        console.error(error);
        // Most likely the unique "one pending report per target" index —
        // not a real failure from the person's point of view.
        toast(error.code === "23505" ? "Ты уже жаловался на это." : "Не удалось отправить жалобу.");
        return;
    }
    toast("Жалоба отправлена. Спасибо!");
}

function reportPost(postId) {
    const post = db.posts.find(p => p.id === postId);
    if (!post) return;
    submitReport("post", postId, post.authorId, "на этот пост");
}

function reportComment(postId, commentId) {
    const comment = db.comments.find(c => c.id === commentId);
    if (!comment) return;
    submitReport("comment", commentId, comment.authorId, "на этот комментарий");
}

function reportProfile(userId) {
    submitReport("profile", userId, userId, "на этот профиль");
}

// One line describing what a report is about, for the moderation queue —
// falls back gracefully if the reported post/comment was since deleted.
function reportTargetPreview(report) {
    if (report.targetType === "post") {
        const post = db.posts.find(p => p.id === report.targetId);
        if (!post) return "Пост удалён.";
        return post.text ? escapeHtml(post.text).slice(0, 140) : (post.image ? "📷 Фото" : "Пустой пост");
    }
    if (report.targetType === "comment") {
        const comment = db.comments.find(c => c.id === report.targetId);
        if (!comment) return "Комментарий удалён.";
        return escapeHtml(comment.text).slice(0, 140);
    }
    return "Профиль пользователя.";
}

function renderModerationQueue() {
    const reports = pendingReports();
    if (!reports.length) {
        return `
            <h2 class="section-title">🚩 Жалобы</h2>
            ${emptyState("🚩", "Жалоб нет", "Пока никто ни на что не пожаловался.")}
        `;
    }
    return `
        <h2 class="section-title">🚩 Жалобы (${reports.length})</h2>
        ${reports.map(reportRow).join("")}
    `;
}

function reportRow(report) {
    const reporter = getUser(report.reporterId);
    const target = getUser(report.targetUserId);
    if (!target) return "";
    const typeLabel = report.targetType === "post" ? "🗒️ Пост" : report.targetType === "comment" ? "💬 Комментарий" : "👤 Профиль";
    const canDeleteContent = report.targetType === "post" || report.targetType === "comment";
    return `
        <div class="card" style="display:flex;flex-direction:column;gap:8px;">

            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <img
                    class="mini-avatar"
                    src="${target.avatar || defaultAvatar()}"
                    onclick="navigate('profile','${target.id}')"
                    style="cursor:pointer"
                >
                <div style="flex:1;min-width:160px;">
                    <strong style="cursor:pointer" onclick="navigate('profile','${target.id}')">${escapeHtml(target.displayName)}</strong>
                    <div style="opacity:.7;font-size:13px;">
                        ${typeLabel} · ${timeAgo(report.createdAt)}
                        ${reporter ? ` · пожаловался(-ась) ${escapeHtml(reporter.displayName)}` : ""}
                    </div>
                </div>
            </div>

            <div style="opacity:.85;font-size:14px;">
                «${reportTargetPreview(report)}»
            </div>

            ${
                report.reason
                ? `<div style="font-size:14px;font-style:italic;opacity:.8;">Причина: ${escapeHtml(report.reason)}</div>`
                : ""
            }

            <div style="display:flex;gap:8px;flex-wrap:wrap;">

                ${
                    target.banned
                        ? `<button class="secondary" onclick="setUserBanned('${target.id}',false)">Разбанить</button>`
                        : `<button class="danger" onclick="setUserBanned('${target.id}',true)">Забанить</button>`
                }

                ${
                    canDeleteContent
                    ? `<button class="secondary" onclick="moderateDeleteReportedContent('${report.id}')">🗑️ Удалить контент</button>`
                    : ""
                }

                <button class="secondary" onclick="dismissReport('${report.id}')">Отклонить жалобу</button>

            </div>

        </div>
    `;
}

async function dismissReport(reportId) {
    if (!isAdmin()) return;
    const report = db.reports.find(r => r.id === reportId);
    if (!report) return;
    const { error } = await sb.from("reports")
        .update({ status: "dismissed", resolved_at: new Date().toISOString(), resolved_by: currentUserId })
        .eq("id", reportId);
    if (error) {
        console.error(error);
        toast("Не удалось отклонить жалобу.");
        return;
    }
    report.status = "dismissed";
    toast("Жалоба отклонена.");
    renderApp();
}

async function moderateDeleteReportedContent(reportId) {
    if (!isAdmin()) return;
    const report = db.reports.find(r => r.id === reportId);
    if (!report) return;
    if (!confirm("Удалить этот контент? Действие нельзя отменить."))
        return;

    if (report.targetType === "post") {
        const [postResult, commentResult] = await Promise.all([
            sb.from("posts").delete().eq("id", report.targetId),
            sb.from("comments").delete().eq("post_id", report.targetId)
        ]);
        if (postResult.error || commentResult.error) {
            toast("Не удалось удалить пост.");
            return;
        }
        db.posts = db.posts.filter(p => p.id !== report.targetId);
        db.comments = db.comments.filter(c => c.postId !== report.targetId);
    } else if (report.targetType === "comment") {
        const idsToRemove = new Set([report.targetId]);
        db.comments.forEach(c => { if (c.parentId === report.targetId) idsToRemove.add(c.id); });
        const { error } = await sb.from("comments").delete().eq("id", report.targetId);
        if (error) {
            toast("Не удалось удалить комментарий.");
            return;
        }
        db.comments = db.comments.filter(c => !idsToRemove.has(c.id));
    }

    const { error: reportError } = await sb.from("reports")
        .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: currentUserId })
        .eq("id", reportId);
    if (!reportError) report.status = "resolved";

    toast("Контент удалён.");
    renderApp();
}

/* ============================================================
   SEARCH
   ============================================================ */

let userSearchQuery = "";

function searchUsers(value, sourceId){
    userSearchQuery = value;
    const query = value.trim().toLowerCase();
    currentPage = "search";
    renderSearchResults(query);
    // renderSearchResults() rebuilds #page's innerHTML, which destroys and
    // recreates #searchPageInput as a brand-new (unfocused) DOM node every
    // keystroke — on mobile that closes the keyboard after a single
    // character. Re-focus + restore the caret on whichever input the
    // person is actually typing in.
    ["searchInput", "searchPageInput"].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.value !== value) el.value = value;
    });
    if (sourceId) {
        const active = document.getElementById(sourceId);
        if (active) {
            active.focus();
            active.setSelectionRange(value.length, value.length);
        }
    }
}

function renderSearchResults(query){
    const users = query
        ? db.users.filter(user => user.id !== currentUserId && (user.username.toLowerCase().includes(query) || user.displayName.toLowerCase().includes(query)))
        : [];

    document.getElementById("page").innerHTML = `

        <h1 class="section-title">
            🔎 Поиск
        </h1>

        <div class="user-search-box">
            <input
                id="searchPageInput"
                placeholder="Поиск пользователей..."
                value="${escapeHtml(userSearchQuery)}"
                oninput="searchUsers(this.value,'searchPageInput')"
            >
        </div>

        ${
            !query
            ? emptyState("🔎", "Найди друзей", "Начни вводить имя пользователя или @юзернейм выше.")
            : users.length
            ? `
                <div class="friend-grid">

                    ${users.map(friendCard).join("")}

                </div>
            `
            : emptyState(
                "🔎",
                "Ничего не найдено",
                "Попробуй другой юзернейм или имя."
            )
        }

    `;
}

/* ============================================================
   DATA LAYER — SUPABASE
   ============================================================ */

function rowToUser(row){
    return {
        id: row.id,
        username: row.username || "user",
        displayName: row.display_name || row.username || "User",
        gender: row.gender || "female",
        avatar: row.avatar || defaultAvatar(),
        cover: row.cover || "",
        bio: row.bio || "",
        lastSeen: row.last_seen || null,
        currentTrack: row.current_track || "",
        currentArtist: row.current_artist || "",
        role: row.role || "user",
        banned: !!row.banned,
        banReason: row.ban_reason || "",
        publicKey: row.public_key || "",
        unlockedAchievements: Array.isArray(row.unlocked_achievements) ? row.unlocked_achievements : [],
        achievementLevel: row.achievement_level || 0,
        customStatusTitle: row.custom_status_title || "",
        customStatusIcon: row.custom_status_icon || "",
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToPost(row) {
    return {
        id: row.id,
        authorId: row.author_id,
        text: row.text || "",
        image: row.image || "",
        musicId: row.music_id || null,
        sharedPostId: row.shared_post_id || null,
        likes: Array.isArray(row.likes) ? row.likes : [],
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToComment(row) {
    return {
        id: row.id,
        postId: row.post_id,
        authorId: row.author_id,
        parentId: row.parent_comment_id || null,
        text: row.text || "",
        likes: [],
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToPet(row) {
    return {
        ownerId: row.owner_id,
        speciesId: row.species_id || "aero_orb",
        name: row.name || "Пузырёныш",
        stage: row.stage || "baby",
        hunger: Number(row.hunger),
        energy: Number(row.energy),
        happiness: Number(row.happiness),
        cleanliness: Number(row.cleanliness),
        health: Number(row.health),
        asleep: !!row.asleep,
        colorPrimary: row.color_primary || null,
        colorSecondary: row.color_secondary || null,
        lastTickAt: row.last_tick_at ? Date.parse(row.last_tick_at) : Date.now(),
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToFriend(row) {
    return {
        id: row.id,
        user1: row.user1,
        user2: row.user2,
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToReport(row) {
    return {
        id: row.id,
        reporterId: row.reporter_id,
        targetType: row.target_type,
        targetId: row.target_id,
        targetUserId: row.target_user_id,
        reason: row.reason || "",
        status: row.status || "pending",
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToStory(row) {
    return {
        id: row.id,
        authorId: row.author_id,
        image: row.image,
        caption: row.caption || "",
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
        expiresAt: row.expires_at ? Date.parse(row.expires_at) : Date.now() + 86400000
    };
}

function rowToFriendRequest(row) {
    return {
        id: row.id,
        fromUser: row.from_user,
        toUser: row.to_user,
        status: row.status || "pending",
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToNotification(row) {
    return {
        id: row.id,
        userId: row.user_id,
        actorId: row.actor_id,
        type: row.type,
        postId: row.post_id || null,
        commentId: row.comment_id || null,
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
        readAt: row.read_at ? Date.parse(row.read_at) : null
    };
}

// Async because fetching (and, on first contact, creating) the shared
// conversation key needs an awaited DB round trip the first time we see a
// given partner in this session.
async function rowToMessage(row) {

    let text = row.text || "";
    let image = row.image || "";

    if (row.encrypted) {
        const partnerId = row.sender_id === currentUserId ? row.receiver_id : row.sender_id;
        let sharedKey = null;
        try {
            sharedKey = await BubblesCrypto.getConversationKey(currentUserId, partnerId);
        } catch (e) {
            console.error(e);
        }
        if (sharedKey) {
            if (text) {
                const decrypted = await BubblesCrypto.decryptString(sharedKey, text, row.iv);
                text = decrypted === null ? "🔒 Не удалось расшифровать сообщение" : decrypted;
            }
            if (image) {
                const decryptedImage = await BubblesCrypto.decryptString(sharedKey, image, row.img_iv);
                image = decryptedImage === null ? "" : decryptedImage;
            }
        } else {
            text = text ? "🔒 Не удалось расшифровать сообщение" : "";
            image = "";
        }
    }

    return {

        id: row.id,

        from: row.sender_id,

        to: row.receiver_id,

        text,

        image,

        createdAt:
            row.created_at
                ? Date.parse(row.created_at)
                : Date.now(),

        readAt:
            row.read_at
                ? Date.parse(row.read_at)
                : null,

        // Filled in separately from message_reactions after load — see
        // loadDB — same two-step attach as post.likes/comment.likes.
        reactions: []

    };

}
function getUnreadMessagesCount() {

    if (
        !Array.isArray(
            db.messages
        )
    ) {
        return 0;
    }


    if (!currentUserId) {
        return 0;
    }


    return db.messages.filter(
        message =>
            message.to ===
                currentUserId &&

            !message.readAt
    ).length;

}

function getUnreadMessagesFromUser(
    userId
) {

    if (
        !Array.isArray(
            db.messages
        )
    ) {
        return 0;
    }


    if (!currentUserId) {
        return 0;
    }


    return db.messages.filter(
        message =>
            message.from === userId &&

            message.to ===
                currentUserId &&

            !message.readAt
    ).length;

}
function setNavBadge(id, count) {
    const badge = document.getElementById(id);
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.classList.remove("hidden");
    } else {
        badge.textContent = "";
        badge.classList.add("hidden");
    }
}

function updateNavBadges() {
    setNavBadge("messagesUnreadBadge", getUnreadMessagesCount());
    setNavBadge("friendRequestsBadge", myIncomingRequests().length);
    setNavBadge("notifBadge", unreadNotificationsCount());
    // There's no separate "Admin" nav item any more — moderation lives on
    // your own profile page (see renderProfile), so this badge on
    // "Профиль" is the only hint an admin gets that reports are waiting.
    setNavBadge("pendingReportsBadge", isAdmin() ? pendingReports().length : 0);
    setNavBadge("petNeedsAttentionBadge", petNeedsAttention() ? 1 : 0);
}

// True if any fast stat has dropped low enough that a visit is
// worthwhile — used only for the little sidebar badge, not for any
// gameplay effect.
function petNeedsAttention() {
    if (!db.pet || db.pet.asleep) return false;
    const p = db.pet;
    return p.hunger < 25 || p.cleanliness < 25 || p.happiness < 25 || isPetSick(p);
}

// Kept as an alias since old inline handlers / other files may still call it.
function updateMessagesBadge() {
    updateNavBadges();
}

function rowToMusic(row) {
    return {
        id: row.id,
        authorId: row.author_id,
        title: row.title || "Без названия",
        artist: row.artist || "Неизвестный артист",
        cover: row.cover_url || "",
        audioUrl: row.audio_url || "",
        audioPath: row.audio_path || "",
        coverPath: row.cover_path || "",
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function userToRow(u) {
    return {
        id: u.id,
        username: u.username,
        display_name: u.displayName,
        gender: u.gender || "female",
        avatar: u.avatar || null,
        cover: u.cover || null,
        bio: u.bio || "",
        created_at: new Date(u.createdAt || Date.now()).toISOString()
    };
}

async function loadDB() {
    try {
        const { data: { user } } = await sb.auth.getUser();
        currentUserId = user?.id || null;
        const [users, posts, comments, postLikes, commentLikes, friends, friendRequests, notifications, messages, messageReactions, music, musicSaves, reports, blocks, stories, storyViews, petRow] = await Promise.all([
            sb.from("profiles").select("*").order("created_at", { ascending: true }),
            sb.from("posts").select("*").order("created_at", { ascending: false }),
            sb.from("comments").select("*").order("created_at", { ascending: true }),
            sb.from("post_likes").select("*"),
            sb.from("comment_likes").select("*"),
            currentUserId ? sb.from("friendships").select("*") : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("friend_requests").select("*").eq("status", "pending") : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("bubbles_notifications").select("*").eq("user_id", currentUserId).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("messages").select("*").order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("message_reactions").select("*") : Promise.resolve({ data: [], error: null }),
            sb.from("music").select("*").order("created_at", { ascending: false }),
            sb.from("music_saves").select("music_id,user_id"),
            // RLS only ever actually returns rows here for the reporter or an
            // admin, so this is cheap/empty for a regular user and only an
            // admin's own profile page ends up showing anything from it.
            currentUserId ? sb.from("reports").select("*").order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
            // RLS restricts this to blocker_id = you, so this is always just
            // your own block list — nobody else's, and nobody can see theirs.
            currentUserId ? sb.from("blocks").select("*") : Promise.resolve({ data: [], error: null }),
            // The select policy already excludes expired rows, so this is
            // just "everyone's currently-active stories".
            sb.from("stories").select("*").order("created_at", { ascending: true }),
            currentUserId ? sb.from("story_views").select("*") : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("pets").select("*").eq("owner_id", currentUserId).maybeSingle() : Promise.resolve({ data: null, error: null })
        ]);
        const result = [users, posts, comments, postLikes, commentLikes, friends, friendRequests, notifications, messages, messageReactions, music, musicSaves, reports, blocks, stories, storyViews, petRow];
        const bad = result.find(x => x?.error);
        if (bad?.error)
            throw bad.error;
        db = {
            users: (users.data || []).map(rowToUser),
            posts: (posts.data || []).map(rowToPost),
            comments: (comments.data || []).map(rowToComment),
            friends: (friends.data || []).map(rowToFriend),
            friendRequests: (friendRequests.data || []).map(rowToFriendRequest),
            notifications: (notifications.data || []).map(rowToNotification),
            messages: [],
            music: (music.data || []).map(rowToMusic),
            reports: (reports.data || []).map(rowToReport),
            blocks: (blocks.data || []).map(row => ({ id: row.id, blockerId: row.blocker_id, blockedId: row.blocked_id })),
            stories: (stories.data || []).map(rowToStory),
            storyViews: (storyViews.data || []).map(row => ({ id: row.id, storyId: row.story_id, viewerId: row.viewer_id })),
            pet: petRow.data ? rowToPet(petRow.data) : null
        };
        // Catches the pet up on however long the app was closed for
        // (see tickPet's comment for why this — not the 30s heartbeat —
        // is what applies the slower "away" decay rate), then starts
        // the heartbeat that ticks it at the normal rate while open.
        if (db.pet) await tickPet({ persist: true, awayCatchUp: true });
        // Ключ переписки (см. js/crypto.js) подтягивается лениво в
        // rowToMessage/sendMessage — тут больше не нужно ничего готовить
        // заранее и не нужно ничего спрашивать у человека.
        db.messages = await Promise.all((messages.data || []).map(rowToMessage));

        // Same two-step attach as post/comment likes: reactions live in
        // their own table (message_reactions) so either side of a chat
        // can add/remove their own row without touching the message.
        const reactionsByMessage = new Map();
        (messageReactions.data || []).forEach(row => {
            if (!reactionsByMessage.has(row.message_id)) reactionsByMessage.set(row.message_id, []);
            reactionsByMessage.get(row.message_id).push({ userId: row.user_id, emoji: row.emoji });
        });
        db.messages.forEach(message => { message.reactions = reactionsByMessage.get(message.id) || []; });

        savesByUser = new Map();
        (musicSaves.data || []).forEach(row => {
            if (!savesByUser.has(row.user_id)) savesByUser.set(row.user_id, new Set());
            savesByUser.get(row.user_id).add(row.music_id);
        });
        if (currentUserId && !savesByUser.has(currentUserId)) savesByUser.set(currentUserId, new Set());
        mySavedMusicIds = savesByUser.get(currentUserId) || new Set();

        // Attach each post's likes from the post_likes table (the source of
        // truth) rather than the old posts.likes jsonb column.
        const likesByPost = new Map();
        (postLikes.data || []).forEach(row => {
            if (!likesByPost.has(row.post_id)) likesByPost.set(row.post_id, []);
            likesByPost.get(row.post_id).push(row.user_id);
        });
        db.posts.forEach(post => { post.likes = likesByPost.get(post.id) || []; });

        // Same pattern for comment likes, from the comment_likes table.
        const likesByComment = new Map();
        (commentLikes.data || []).forEach(row => {
            if (!likesByComment.has(row.comment_id)) likesByComment.set(row.comment_id, []);
            likesByComment.get(row.comment_id).push(row.user_id);
        });
        db.comments.forEach(comment => { comment.likes = likesByComment.get(comment.id) || []; });
    }
    catch (error) {
        console.error("Supabase load error:", error);
        toast("Не удалось загрузить данные из Supabase: " + (error?.message || error), 9000);
    }
}

async function saveDB() {
    try {
        const users = db.users.map(userToRow);
        const posts = db.posts.map(p => ({
            id: p.id,
            author_id: p.authorId,
            text: p.text || "",
            image: p.image || "",
            music_id: p.musicId || null,
            shared_post_id: p.sharedPostId || null,
            likes: p.likes || [],
            created_at: new Date(p.createdAt || Date.now()).toISOString()
        }));
        const comments = db.comments.map(c => ({
            id: c.id,
            post_id: c.postId,
            author_id: c.authorId,
            parent_comment_id: c.parentId || null,
            text: c.text || "",
            created_at: new Date(c.createdAt || Date.now()).toISOString()
        }));
        const friends = db.friends.map(f => ({
            id: f.id,
            user1: f.user1,
            user2: f.user2,
            created_at: new Date(f.createdAt || Date.now()).toISOString()
        }));
        // NOTE: messages are intentionally NOT bulk-upserted here. db.messages
        // holds the *decrypted* plaintext (for display), so writing it back
        // would overwrite the ciphertext in the messages table with
        // plaintext and defeat E2E encryption. Sending a message always
        // goes through sendMessage(), which encrypts before insert.
        const music = db.music.map(m => ({
            id: m.id,
            author_id: m.authorId,
            title: m.title,
            artist: m.artist || "",
            cover_url: m.cover || "",
            audio_url: m.audioUrl || "",
            audio_path: m.audioPath || "",
            cover_path: m.coverPath || "",
            created_at: new Date(m.createdAt || Date.now()).toISOString()
        }));
        const writes = [
            users.length ? sb.from("profiles").upsert(users) : null,
            posts.length ? sb.from("posts").upsert(posts) : null,
            comments.length ? sb.from("comments").upsert(comments) : null,
            friends.length ? sb.from("friendships").upsert(friends) : null,
            music.length ? sb.from("music").upsert(music) : null
        ].filter(Boolean);
        const results = await Promise.all(writes);
        const bad = results.find(r => r.error);
        if (bad?.error)
            throw bad.error;
    }
    catch (error) {
        console.error("Supabase save error:", error);
        toast("Не удалось сохранить изменения в Supabase.");
    }
}

async function ensureProfile(authUser) {
    if (!authUser)
        return null;
    const { data: existing, error: readError } = await sb
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();
    if (readError)
        throw readError;
    if (existing)
        return rowToUser(existing);
    const meta = authUser.user_metadata || {};
    let username = String(meta.username || "user").trim().toLowerCase();
    let displayName = String(meta.displayName || username).trim();
    const { data: collision } = await sb
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();
    if (collision) {
        username = username + "_" + Math.random().toString(36).slice(2, 7);
    }
    const row = {
        id: authUser.id,
        username,
        display_name: displayName,
        gender: meta.gender || "female",
        avatar: "",
        cover: "",
        bio: "",
        created_at: new Date().toISOString()
    };
    const { data, error } = await sb
        .from("profiles")
        .insert(row)
        .select()
        .single();
    if (error)
        throw error;
    return rowToUser(data);
}

/* ============================================================
   LIVE UPDATES (Supabase Realtime)
   Replaces the old js/realtime.js, social-realtime.js and
   online.js files, which duplicated this logic in a way that
   didn't reliably match the real DOM structure.
   ============================================================ */

function watchChatPartnerPresence(userId) {
    stopWatchingChatPartnerPresence();
    const refresh = async () => {
        const { data, error } = await sb.from("profiles").select("last_seen").eq("id", userId).maybeSingle();
        if (error || !data) return;
        const user = getUser(userId);
        if (user) user.lastSeen = data.last_seen;
        const el = document.getElementById("chatPartnerStatus");
        if (el) el.textContent = isUserOnline(data.last_seen) ? "🟢 Онлайн" : "⚪ Не в сети";
    };
    refresh();
    chatPartnerPresenceTimer = setInterval(refresh, 15000);
}

function stopWatchingChatPartnerPresence() {
    if (chatPartnerPresenceTimer) {
        clearInterval(chatPartnerPresenceTimer);
        chatPartnerPresenceTimer = null;
    }
}

function setupMessagesRealtime() {
    if (messagesChannel) sb.removeChannel(messagesChannel);
    messagesChannel = sb.channel("bubbles-messages-" + currentUserId)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
            const row = payload.new;
            if (row.sender_id !== currentUserId && row.receiver_id !== currentUserId) return;
            if (row.sender_id === currentUserId) return; // I already added it optimistically
            const message = await rowToMessage(row);
            db.messages.push(message);
            if (currentPage === "messages" && selectedChatId === message.from) {
                appendMessageToChat(message, message.from);
                markChatAsRead(message.from);
            } else {
                if (currentPage === "messages") refreshConversationPreview(message.from);
                showNewMessagePopup(message);
            }
            updateNavBadges();
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
            const row = payload.new;
            const local = db.messages.find(m => m.id === row.id);
            if (!local) return;
            local.readAt = row.read_at ? Date.parse(row.read_at) : null;
            if (local.from === currentUserId) {
                const bubble = document.querySelector(`[data-bubbles-message-id="${local.id}"] .read-tick`);
                if (bubble) {
                    bubble.textContent = local.readAt ? "✓✓" : "✓";
                    bubble.classList.toggle("read", !!local.readAt);
                }
            }
        })
        // A reaction insert/switch. Supabase's upsert (used when someone
        // changes their emoji) replicates as an UPDATE once the row
        // already exists, so INSERT and UPDATE get the same handling here.
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions" }, applyRemoteReaction)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "message_reactions" }, applyRemoteReaction)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, (payload) => {
            const row = payload.old;
            if (row.user_id === currentUserId) return; // already applied optimistically
            const message = db.messages.find(m => m.id === row.message_id);
            if (!message) return;
            message.reactions = (message.reactions || []).filter(r => r.userId !== row.user_id);
            refreshMessageBubbleInPlace(row.message_id);
        })
        .subscribe();
}

function applyRemoteReaction(payload) {
    const row = payload.new;
    if (row.user_id === currentUserId) return; // already applied optimistically
    const message = db.messages.find(m => m.id === row.message_id);
    if (!message) return;
    if (!message.reactions) message.reactions = [];
    message.reactions = message.reactions.filter(r => r.userId !== row.user_id);
    message.reactions.push({ userId: row.user_id, emoji: row.emoji });
    refreshMessageBubbleInPlace(row.message_id);
}

function setupNotificationsRealtime() {
    if (notificationsChannel) sb.removeChannel(notificationsChannel);
    notificationsChannel = sb.channel("bubbles-notifications-" + currentUserId)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "bubbles_notifications" }, (payload) => {
            const row = payload.new;
            if (row.user_id !== currentUserId) return;
            if (db.notifications.some(n => n.id === row.id)) return;
            db.notifications.unshift(rowToNotification(row));
            updateNavBadges();
            // No toast here on purpose — friend requests, friend
            // acceptance, and new messages already announce themselves
            // via their own toast/popup elsewhere. This just keeps the
            // bell's badge and history in sync in the background.
            const panel = document.getElementById("notifPanel");
            if (panel && !panel.classList.contains("hidden")) panel.innerHTML = renderNotificationsPanel();
        })
        .subscribe();
}

function setupFriendRequestsRealtime() {
    if (friendRequestsChannel) sb.removeChannel(friendRequestsChannel);
    friendRequestsChannel = sb.channel("bubbles-friend-requests-" + currentUserId)
        .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, (payload) => {
            const row = payload.new || payload.old;
            if (!row || (row.from_user !== currentUserId && row.to_user !== currentUserId)) return;
            db.friendRequests = db.friendRequests.filter(r => r.id !== row.id);
            if (payload.eventType !== "DELETE" && row.status === "pending") {
                db.friendRequests.push(rowToFriendRequest(row));
            }
            if (payload.eventType === "INSERT" && row.to_user === currentUserId) {
                const sender = getUser(row.from_user);
                toast(`${sender?.displayName || "Кто-то"} отправил(а) заявку в друзья 🫂`);
            }
            updateNavBadges();
            if (currentPage === "friends") renderFriends();
            if (currentPage === "profile") renderProfile(selectedProfileId || currentUserId);
        })
        .subscribe();
}

function setupSocialRealtime() {
    if (socialChannel) sb.removeChannel(socialChannel);
    socialChannel = sb.channel("bubbles-social-" + currentUserId)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "post_likes" }, (payload) => {
            const post = db.posts.find(p => p.id === payload.new.post_id);
            if (!post) return;
            if (!post.likes.includes(payload.new.user_id)) post.likes.push(payload.new.user_id);
            refreshPostInPlace(post.id);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "post_likes" }, (payload) => {
            const post = db.posts.find(p => p.id === payload.old.post_id);
            if (!post) return;
            post.likes = post.likes.filter(id => id !== payload.old.user_id);
            refreshPostInPlace(post.id);
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments" }, (payload) => {
            if (db.comments.some(c => c.id === payload.new.id)) return; // already added optimistically
            if (payload.new.author_id === currentUserId) return;
            db.comments.push(rowToComment(payload.new));
            refreshPostInPlace(payload.new.post_id);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "comments" }, (payload) => {
            const removedId = payload.old.id;
            const comment = db.comments.find(c => c.id === removedId);
            if (!comment) return; // already removed optimistically by our own deleteComment
            const postId = comment.postId;
            // A deleted top-level comment cascades to its replies in the DB —
            // mirror that locally too.
            db.comments = db.comments.filter(c => c.id !== removedId && c.parentId !== removedId);
            openReplyThreads.delete(removedId);
            refreshPostInPlace(postId);
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "comment_likes" }, (payload) => {
            const comment = db.comments.find(c => c.id === payload.new.comment_id);
            if (!comment) return;
            if (!comment.likes.includes(payload.new.user_id)) comment.likes.push(payload.new.user_id);
            refreshPostInPlace(comment.postId);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "comment_likes" }, (payload) => {
            const comment = db.comments.find(c => c.id === payload.old.comment_id);
            if (!comment) return;
            comment.likes = comment.likes.filter(id => id !== payload.old.user_id);
            refreshPostInPlace(comment.postId);
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, (payload) => {
            if (payload.new.author_id === currentUserId) return;
            if (db.posts.some(p => p.id === payload.new.id)) return;
            const post = rowToPost(payload.new);
            post.likes = [];
            db.posts.unshift(post);
            if (currentPage === "feed") renderFeed();
        })
        .subscribe();
}

function teardownRealtime() {
    [messagesChannel, friendRequestsChannel, notificationsChannel, typingChannel, socialChannel].forEach(ch => { if (ch) sb.removeChannel(ch); });
    messagesChannel = null;
    friendRequestsChannel = null;
    notificationsChannel = null;
    typingChannel = null;
    typingChannelPartnerId = null;
    socialChannel = null;
    stopWatchingChatPartnerPresence();
}

/* ------------------------------------------------------------
   Auto-advance to the next track when one finishes playing.
   ------------------------------------------------------------ */
(function setupAudioAutoplay(){
    const audio = document.getElementById("globalAudio");
    if (!audio) return;
    audio.addEventListener("ended", () => {
        if (musicAutoplay) playNextTrack();
        else refreshMusicCardPlayState(null);
    });
})();

/* ============================================================
   INIT — SUPABASE
   ============================================================ */

(async function(){
    try{
        const {data:{session}}=await sb.auth.getSession();
        currentUserId=session?.user?.id||null;
        if(currentUserId) await bootstrapSession(session.user);
        else showAuth("landing");
    }catch(error){
        console.error("Bubbles init error:",error);
        showAuth("landing");
        toast("Проверь Supabase URL и ключ в js/supabase-config.js");
    }
})();

sb.auth.onAuthStateChange(async (_event,session)=>{
    if(session?.user){
        try{ await bootstrapSession(session.user); }catch(error){console.error(error);}
    }else if(_event==="SIGNED_OUT"){
        currentUserId=null;
        sessionBootstrapUserId=null;
        sessionBootstrapPromise=null;
    }
});

/* Functions used by the existing inline HTML handlers. */
Object.assign(window,{
    showAuth,loginForm,registerForm,selectGender,register,login,logout,
    navigate,renderFeed,renderProfile,renderFriends,renderMessages,renderMusic,renderEditProfile,
    searchUsers,createPost,toggleLike,toggleCommentLike,addComment,deleteComment,focusComment,openReplyBox,closeReplyBox,deletePost,
    saveProfile,previewAvatar,openChat,sendMessage,handleTyping,uploadMusic,playMusic,closeMusicPlayer,deleteMusic,
    toggleMessageReaction,toggleReactionPicker,
    toggleNotificationsPanel,goToPost,
    sendFriendRequest,cancelFriendRequest,declineFriendRequest,acceptFriendRequest,removeFriend,
    setMusicTab,setMusicSearch,setMusicAutoplay,playNextTrack,playPrevTrack,toggleMusicSave,
    toggleProfileMusicExpanded,toggleProfileFriendsExpanded,toggleProfileAchievementsExpanded,
    setUserRole,setUserBanned,setCustomStatus,clearCustomStatus,backfillAchievementsForAllUsers,
    reportPost,reportComment,reportProfile,dismissReport,moderateDeleteReportedContent,
    toggleBlockUser,
    addStoryPrompt,openStoryViewer,closeStoryViewer,storyViewerAdvance,deleteCurrentStory,
    closeBubblesModal,
    openSharePicker,openShareToProfile,shareToProfile,openShareToChat,shareToChat,focusSharedPost,
    openMusicPicker,selectComposerMusic,removeComposerMusic,
    openEditPost,renderEditPostModal,handleEditPostImageSelect,removeEditPostImage,removeEditPostMusic,saveEditPost,syncEditPostTextFromDom,
    submitCreatePet,feedPet,playPet,cleanPet,toggleSleepPet
});
