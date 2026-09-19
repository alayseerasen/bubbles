/* ============================================================
   BUBBLES
   Local prototype social network
   ============================================================ */

const MAX_MUSIC_SIZE = 15 * 1024 * 1024;
const MAX_COVER_SIZE = 5 * 1024 * 1024;
const MUSIC_BUCKET = "music";
const IMAGES_BUCKET = "images";
const QUICK_REACTIONS = ["❤️", "😂", "👍", "😮", "😢"];
// Post reactions are a fixed, non-Bubbles+-gated set (see spec) — deliberately
// a separate constant from the chat's QUICK_REACTIONS/PLUS_REACTIONS since
// there's no reason the two surfaces need to share the exact same emoji.
const POST_REACTIONS = ["❤️", "🫧", "✨", "😂", "😮"];
const STORY_REACTIONS = ["❤️", "😂", "😮", "🔥", "👏"];

/* ============================================================
   BUBBLES+ — subscription config
   ------------------------------------------------------------
   Everything about what's for sale and what it unlocks lives here,
   client-side — same philosophy as achievements. The database only
   ever stores the RESULT (tier + expiry + which frame/theme is
   currently selected), never these definitions.

   Payment is deliberately manual (see renderPremium() /
   createSubscriptionRequest()): a person picks a plan, gets shown
   PAYMENT_INSTRUCTIONS, and submits a request that sits pending until
   an admin confirms the payment arrived and approves it from the
   moderation queue on their own profile page. No payment processor,
   no card/bank data touches this code at all — swap
   PAYMENT_INSTRUCTIONS below for however you actually want to get
   paid (a crypto address, a link, "напиши мне в директ", whatever).
   ============================================================ */

const SUBSCRIPTION_PLANS = [
    { months: 1, price: "150₽", perMonth: null },
    { months: 6, price: "750₽", perMonth: "125₽/мес", save: "Выгода 17%" },
    { months: 12, price: "1200₽", perMonth: "100₽/мес", save: "Выгода 33%" }
];

// Edit this to however you actually want to get paid — it's just shown
// as plain text on the purchase screen, nothing here talks to a real
// payment provider.
const PAYMENT_INSTRUCTIONS =
    "Переведи по реквизитам, которые тебе прислали отдельно, и нажми кнопку ниже — заявка уйдёт на подтверждение, подписку включат вручную, обычно быстро.";

const FRAME_OPTIONS = [
    { id: "gold", label: "Золотая", swatch: "linear-gradient(135deg,#ffe89c,#ffc65c)" },
    { id: "neon", label: "Неоновая", swatch: "linear-gradient(135deg,#7ef7e0,#12c9a8)" },
    { id: "holo", label: "Голографическая", swatch: "conic-gradient(from 0deg,#ff9a9e,#fad0c4,#a1c4fd,#c2e9fb,#ff9a9e)" }
];

const THEME_OPTIONS = [
    { id: "default", label: "Обычная", swatch: "linear-gradient(135deg,#4fc9f5,#7ee56d)" },
    { id: "sunset", label: "Закат", swatch: "linear-gradient(135deg,#ff9868,#e2632f)" },
    { id: "galaxy", label: "Галактика", swatch: "linear-gradient(135deg,#9d7bff,#5c33c9)" },
    { id: "mint", label: "Мята", swatch: "linear-gradient(135deg,#57e0b8,#149a75)" }
];

// Extra reaction row shown only to subscribers in the message reaction
// picker — QUICK_REACTIONS above stays exactly as-is for everyone else.
const PLUS_REACTIONS = ["🫧", "✨", "💎", "🌈", "🔥", "😻"];

function isSubscriber(user) {
    return !!user
        && user.subscriptionTier === "plus"
        && !!user.subscriptionExpiresAt
        && user.subscriptionExpiresAt > Date.now();
}

function subscriptionDaysLeft(user) {
    if (!isSubscriber(user)) return 0;
    return Math.max(0, Math.ceil((user.subscriptionExpiresAt - Date.now()) / 86400000));
}

// The extra class to fold into any avatar <img>'s class="" attribute —
// empty string when the user isn't an active subscriber or hasn't
// picked a frame, so this is always safe to interpolate directly.
function avatarFrameClass(user) {
    if (!isSubscriber(user) || !user.subscriptionFrame || user.subscriptionFrame === "none") return "";
    return ` sub-frame-${user.subscriptionFrame}`;
}

// Small inline "💎 Bubbles+" tag — pass a size like "11px" to match
// whatever text it's sitting next to, or leave it at the default.
function subBadge(user, { fontSize } = {}) {
    if (!isSubscriber(user)) return "";
    return `<span class="sub-badge"${fontSize ? ` style="font-size:${fontSize}"` : ""}>💎 Plus</span>`;
}

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
        check: (id) => { const u = getUser(id); return !!u && (Date.now() - u.createdAt) >= 180 * 86400000; } },
    { id: "aero_visitor", icon: "🌐", title: "Гость Aero World", description: "Зашёл в Aero World под тем же аккаунтом" }, // manual — из aero-account.js
    { id: "aero_konami", icon: "🕹️", title: "Секретный код", description: "Нашёл пасхалку в Aero World" } // manual — из aero-account.js
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
        name: "Баблу",
        description: "Глянцевый желейный человечек — как стеклянная игрушка, только живой.",
        colorPrimary: "#b9ff9b",
        colorSecondary: "#149a3c"
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
// Shape/gloss is modeled on a glassy jelly figurine (round head, side
// arm lobes, a seam ring at the neck, several separate specular
// highlights) — the face stays on top of that for mood feedback
// (happy/sad/sick/asleep), since a virtual pet needs to be able to
// visibly react even though the reference figurine itself is blank.
function renderPetCreature(pet) {
    const species = getPetSpecies(pet.speciesId);
    const c1 = pet.colorPrimary || species.colorPrimary;
    const c2 = pet.colorSecondary || species.colorSecondary;
    const sizeScale = pet.stage === "adult" ? 1 : pet.stage === "juvenile" ? 0.9 : 0.78;
    const mood = pet.asleep ? "asleep" : isPetSick(pet) ? "sick" : pet.happiness < 30 ? "sad" : "happy";
    return `
        <div class="pet-creature-wrap ${mood}" style="--pet-color-1:${c1};--pet-color-2:${c2};--pet-scale:${sizeScale}">
            <svg viewBox="0 0 220 280" class="pet-creature-svg">
                <defs>
                    <radialGradient id="petGloss" cx="35%" cy="25%" r="80%">
                        <stop offset="0%" stop-color="#ffffff" stop-opacity=".98"/>
                        <stop offset="28%" stop-color="var(--pet-color-1)" stop-opacity=".95"/>
                        <stop offset="100%" stop-color="var(--pet-color-2)"/>
                    </radialGradient>
                    <radialGradient id="petGlossDark" cx="40%" cy="20%" r="85%">
                        <stop offset="0%" stop-color="var(--pet-color-1)" stop-opacity=".85"/>
                        <stop offset="100%" stop-color="var(--pet-color-2)"/>
                    </radialGradient>
                </defs>
                <ellipse cx="110" cy="265" rx="66" ry="10" fill="rgba(15,60,35,.16)"/>

                <!-- arms: two rounded lobes attached to the torso -->
                <ellipse cx="46" cy="200" rx="26" ry="34" fill="url(#petGlossDark)" stroke="var(--pet-color-2)" stroke-width="3.5"/>
                <ellipse cx="174" cy="200" rx="26" ry="34" fill="url(#petGlossDark)" stroke="var(--pet-color-2)" stroke-width="3.5"/>

                <!-- torso -->
                <path d="M56 260 C48 190 52 148 110 148 C168 148 172 190 164 260 Z" fill="url(#petGloss)" stroke="var(--pet-color-2)" stroke-width="4"/>

                <!-- head -->
                <circle cx="110" cy="80" r="64" fill="url(#petGloss)" stroke="var(--pet-color-2)" stroke-width="4"/>
                <!-- seam ring where the head meets the body, like the figurine's neck rim -->
                <ellipse cx="110" cy="146" rx="30" ry="8" fill="none" stroke="var(--pet-color-2)" stroke-width="3" opacity=".55"/>

                <!-- multiple glossy highlights, like light catching curved glass -->
                <ellipse cx="82" cy="48" rx="24" ry="16" fill="#fff" opacity=".8" transform="rotate(-18 82 48)"/>
                <ellipse cx="145" cy="70" rx="7" ry="10" fill="#fff" opacity=".55"/>
                <ellipse cx="90" cy="185" rx="16" ry="22" fill="#fff" opacity=".35"/>
                <ellipse cx="150" cy="215" rx="6" ry="9" fill="#fff" opacity=".4"/>

                <g class="pet-face">
                    <circle cx="86" cy="82" r="7" class="pet-eye"/>
                    <circle cx="134" cy="82" r="7" class="pet-eye"/>
                    <path class="pet-mouth" d="M92 104 Q110 118 128 104" fill="none" stroke="#0f3d24" stroke-width="4" stroke-linecap="round"/>
                </g>
            </svg>
        </div>
    `;
}

// A small ambient scene the pet "lives in" — window, floor, a couple
// of drifting bubbles — purely decorative for now (CSS/SVG only, no
// image assets), and a natural place to hang furniture/room cosmetics
// off of later without touching the pet-rendering code at all.
function renderPetRoom(innerHtml) {
    const bubbles = [18, 42, 68, 85].map((left, i) => `
        <span class="pet-room-bubble" style="--left:${left}%;--delay:${i * 1.8}s;--size:${14 + (i % 3) * 8}px"></span>
    `).join("");
    return `
        <div class="pet-room">
            <div class="pet-room-window">
                <span class="pet-room-cloud c1"></span>
                <span class="pet-room-cloud c2"></span>
            </div>
            ${bubbles}
            <div class="pet-room-floor"></div>
            <div class="pet-room-rug"></div>
            <div class="pet-room-stage">${innerHtml}</div>
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

// ------------------------------------------------------------
// VISITING A FRIEND'S PET — the one social hook the pet had none of
// before: you can look in on a friend's pet and top it up once a day
// (see feed_friends_pet() in supabase.sql for the actual limit/boost,
// enforced server-side, not just here). Doesn't touch db.pet (that's
// always YOUR OWN pet, loaded once at login) — this fetches whichever
// friend's pet on demand and renders a lightweight read-mostly view.
// ------------------------------------------------------------
async function visitFriendsPet(userId) {
    if (userId === currentUserId) { navigate("pet"); return; }
    currentPage = "pet";
    selectedProfileId = userId;
    document.querySelectorAll("[data-page]").forEach(btn => btn.classList.toggle("active", btn.dataset.page === "pet"));
    const page = document.getElementById("page");
    page.innerHTML = `<div class="empty">Заходим в гости…</div>`;
    const { data, error } = await sb.from("pets").select("*").eq("owner_id", userId).maybeSingle();
    if (error) { console.error(error); toast("Не удалось загрузить питомца."); navigate("profile", userId); return; }
    if (!data) {
        page.innerHTML = emptyState("🐣", "Питомца пока нет", "У этого человека ещё нет питомца.");
        return;
    }
    renderFriendsPetView(userId, rowToPet(data));
}

function renderFriendsPetView(userId, pet) {
    const owner = getUser(userId);
    const page = document.getElementById("page");
    const sick = isPetSick(pet);
    page.innerHTML = `
        <h2 class="section-title">🐣 Питомец ${escapeHtml(owner?.displayName || "")}</h2>
        <div class="card pet-card">
            <div class="pet-status-row">
                <span class="pet-stage-badge">${petStageLabel(pet.stage)}</span>
                ${pet.asleep ? `<span class="pet-flag asleep">💤 Спит</span>` : ""}
                ${sick ? `<span class="pet-flag sick">🤒 Приболел</span>` : ""}
            </div>
            ${renderPetRoom(renderPetCreature(pet))}
            <h3 class="pet-name">${escapeHtml(pet.name)}</h3>
            <div id="friendsPetStats">
                ${petStatBar("Сытость", "🍬", pet.hunger)}
                ${petStatBar("Бодрость", "⚡", pet.energy)}
                ${petStatBar("Радость", "💗", pet.happiness)}
            </div>
            <button id="feedFriendsPetBtn" class="primary full" onclick="feedFriendsPetAction('${userId}')">
                😋 Покормить
            </button>
            <p class="pet-visit-note">Можно заходить раз в день — так у всех питомцев в сети есть шанс на гостей 🫧</p>
        </div>
        <button class="secondary" onclick="navigate('profile','${userId}')">← Назад в профиль</button>
    `;
}

async function feedFriendsPetAction(userId) {
    const btn = document.getElementById("feedFriendsPetBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Кормим…"; }
    const { data, error } = await sb.rpc("feed_friends_pet", { target_owner_id: userId });
    if (error) {
        console.error(error);
        toast(error.message?.includes("нет питомца") ? error.message : "Не удалось покормить питомца.");
        if (btn) { btn.disabled = false; btn.textContent = "😋 Покормить"; }
        return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    const statsEl = document.getElementById("friendsPetStats");
    if (statsEl) {
        statsEl.innerHTML = `
            ${petStatBar("Сытость", "🍬", row.hunger)}
            ${petStatBar("Бодрость", "⚡", row.energy)}
            ${petStatBar("Радость", "💗", row.happiness)}
        `;
    }
    if (row.already_fed) {
        toast("Уже заходил(а) сегодня — возвращайся завтра 🌙");
        if (btn) { btn.disabled = true; btn.textContent = "Уже покормлен(а) сегодня"; }
    } else {
        toast("Спасибо от питомца! 🎉");
        if (btn) { btn.disabled = true; btn.textContent = "Покормлен(а) на сегодня"; }
        createNotification({ userId, type: "pet_fed" });
    }
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
            ${renderPetRoom(renderPetCreature(pet))}
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
    haptic("achievement");
    newlyUnlocked.forEach(id => {
        const a = ACHIEVEMENTS.find(x => x.id === id);
        if (a) {
            toast(`🏆 Новое достижение: ${a.icon} ${a.title}!`, 5000);
            pushSystemNotification(`Новое достижение: ${a.icon} ${a.title}`, "🏆");
        }
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
    haptic("achievement");
    const a = ACHIEVEMENTS.find(x => x.id === achievementId);
    if (a) {
        toast(`🏆 Новое достижение: ${a.icon} ${a.title}!`, 5000);
        pushSystemNotification(`Новое достижение: ${a.icon} ${a.title}`, "🏆");
    }
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
        if (tier) {
            toast(`${tier.icon} Новый статус: ${tier.title}!`, 6000);
            pushSystemNotification(`Новый статус: ${tier.title}`, tier.icon);
        }
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
//
// IMPORTANT: sw.js MUST live at the SITE ROOT (./sw.js), not under /js/.
// A service worker's default max scope is the directory it's served
// from — registering js/sw.js with scope:"./" (the whole site) exceeds
// that and throws a SecurityError. That was the actual bug that broke
// push for everyone, on every platform: the file was sitting in /js/
// while this code (correctly) asked for it at the root, so the
// registration 404'd/threw and silently never happened — no service
// worker, no push, ever, and it looked like "nothing" was wrong because
// the .catch() below just logged it to a console nobody was watching.
// It's fixed now (sw.js ships at the project root, next to index.html)
// but the check stays here as a guardrail against it regressing again.
if ("serviceWorker" in navigator) {
    // ?v=3 forces the browser to treat this as a fresh fetch instead of
    // reusing a cached sw.js — bump this alongside the ?v= in index.html
    // whenever sw.js itself changes.
    navigator.serviceWorker.register("./sw.js?v=3", { scope: "./" })
        .then(reg => {
            // Proactively check for a newer sw.js on every load instead of
            // waiting for the browser's own (slow, unpredictable) update
            // cycle — matters a lot on iOS Home Screen apps, which don't
            // get background update checks the way a normal browser tab does.
            reg.update().catch(() => {});
        })
        .catch(err => console.error("Service worker registration failed — push notifications will not work:", err));
} else {
    console.warn("This browser has no Service Worker support — push notifications are unavailable.");
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
    subscriptionRequests: [],
    blocks: [],
    stories: [],
    storyViews: [],
    canvasItems: [], // whichever canvas room is currently open (see openCanvasRoom)
    pet: null // this account's single companion, or null if none created yet
};

let currentUserId = null;
let currentPage = "feed";
let selectedProfileId = null;
// Starts expanded so landing directly on one of the tucked-away pages
// (Поиск/Комната/Питомец/Bubbles+/Настройки) — e.g. via a deep link or
// a button elsewhere in the app — doesn't hide its own nav highlight
// behind a collapsed "Ещё" toggle.
let sidebarMoreExpanded = ["friends","music","rooms","groupRooms","roomChat","saved","pet","premium","edit"].includes(currentPage);
function toggleSidebarMore(){
    sidebarMoreExpanded = !sidebarMoreExpanded;
    renderApp();
}
let profileMusicExpanded = false;
let profileFriendsExpanded = false;
let profileAchievementsExpanded = false;
let lastProfileRenderId = null;
let profileTab = "posts"; // "posts" | "music" | "friends" | "media"
let notifFilterTab = "all"; // "all" | "social" | "messages" | "system"
// Session-only, not persisted — achievement unlocks already toast once
// (see recomputeAchievements); this just keeps that moment visible in
// the "Система" tab for a bit afterwards too, in case the toast was
// missed. Doesn't need to survive a refresh the way social notifications
// (their own DB table) do.
let systemNotifications = [];
let selectedChatId = null;
let selectedCanvasUserId = null; // whose canvas room is currently open — see openCanvasRoom
let canvasBackground = "sky";
let selectedMessageImage = null; // resized data URL staged to send in the current chat, or null
let replyingToMessageId = null; // message the compose box is currently replying to, or null
let editingMessageId = null; // message currently being edited in the compose box, or null
let chatSearchOpen = false;
let chatSearchQuery = "";
let selectedComposerMusicId = null; // track staged to attach to the next post, or null
let wallTargetUserId = null; // profile whose wall is currently being composed to
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
let musicSearchDebounceTimer = null;
let musicQueue = [];             // ids, in the order currently shown
let musicAutoplay = true;

// Кроппер (см. js/image-cropper.js) отдаёт уже готовый обрезанный Blob —
// храним его тут до момента сохранения, вместо того чтобы заново читать
// исходный файл из <input>.
let pendingAvatarBlob = null;
let pendingAvatarExt = "jpg"; // "jpg" (прошёл через кроппер) или "gif" (загружен как есть, без кропа — иначе теряется анимация)
let pendingCoverBlob = null;
let pendingMusicCoverBlob = null;
let mySavedMusicIds = new Set(); // tracks (by others) I've added to my library
let myRecentPlays = []; // [{musicId, playedAt}], most-recent-first, one entry per track — see loadDB
const lastPlayLoggedAt = new Map(); // musicId -> ms timestamp, so replaying/scrubbing the same track doesn't spam music_plays inserts
let mySavedPostIds = new Set(); // posts I've bookmarked to my private "Сохранённое" list
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
   FOLLOWS — separate, one-directional, no accept step (see friend
   requests above for the handshake-based relationship instead).
   ------------------------------------------------------------ */
function isFollowing(userId) {
    return db.follows.some(f => f.followerId === currentUserId && f.followedId === userId);
}

function followersOf(userId) {
    return db.follows.filter(f => f.followedId === userId).map(f => f.followerId);
}

function followingOf(userId) {
    return db.follows.filter(f => f.followerId === userId).map(f => f.followedId);
}

async function toggleFollow(userId) {
    if (!userId || userId === currentUserId) return;
    const wasFollowing = isFollowing(userId);

    // Optimistic update, same pattern as toggleReaction/toggleSavePost —
    // reconciled from the server on failure below.
    if (wasFollowing) db.follows = db.follows.filter(f => !(f.followerId === currentUserId && f.followedId === userId));
    else db.follows.push({ followerId: currentUserId, followedId: userId });
    if (currentPage === "profile") renderProfile(selectedProfileId || currentUserId);

    const { error } = wasFollowing
        ? await sb.from("follows").delete().eq("follower_id", currentUserId).eq("followed_id", userId)
        : await sb.from("follows").insert({ follower_id: currentUserId, followed_id: userId });

    if (error) {
        console.error(error);
        if (wasFollowing) db.follows.push({ followerId: currentUserId, followedId: userId });
        else db.follows = db.follows.filter(f => !(f.followerId === currentUserId && f.followedId === userId));
        if (currentPage === "profile") renderProfile(selectedProfileId || currentUserId);
        toast("Не удалось подписаться.");
        return;
    }

    if (!wasFollowing) createNotification({ userId, type: "new_follower" });
}

// Followers/following lists — reuses the same friendCard + friend-grid
// markup as the friends tab and search results, just filtered to one
// side of the follow graph instead of the friendships table.
function openFollowListModal(userId, kind) {
    const user = getUser(userId);
    if (!user) return;
    const ids = kind === "followers" ? followersOf(userId) : followingOf(userId);
    const users = ids.map(getUser).filter(Boolean);
    showBubblesModal(`
        <div class="modal-header">
            <h3>${kind === "followers" ? "Подписчики" : "Подписки"}</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        ${
            users.length
            ? `<div class="friend-grid" onclick="closeBubblesModal()">${users.map(friendCard).join("")}</div>`
            : emptyState("🔔", kind === "followers" ? "Пока нет подписчиков" : "Пока никто не выбран", "")
        }
    `);
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
        // Same reasoning for follows in either direction — no point
        // staying in each other's followers/following lists once blocked.
        await Promise.all([
            sb.from("follows").delete().eq("follower_id", currentUserId).eq("followed_id", userId),
            sb.from("follows").delete().eq("follower_id", userId).eq("followed_id", currentUserId)
        ]);
        db.follows = db.follows.filter(f =>
            !(f.followerId === currentUserId && f.followedId === userId) &&
            !(f.followerId === userId && f.followedId === currentUserId)
        );
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
                    <img loading="lazy" decoding="async" class="story-ring-avatar" src="${me?.avatar || defaultAvatar()}">
                    ${!storiesByAuthor(currentUserId).length ? `<span class="story-add-badge">+</span>` : ""}
                </div>
                <span class="story-ring-label">Ты</span>
            </div>

            ${entries.filter(u => u.id !== currentUserId).map(u => `
                <div class="story-ring-item">
                    <div class="story-ring ${hasUnseenStories(u.id) ? "unseen" : "seen"}" onclick="openStoryViewer('${u.id}')">
                        <img loading="lazy" decoding="async" class="story-ring-avatar" src="${u.avatar || defaultAvatar()}">
                    </div>
                    <span class="story-ring-label">${escapeHtml(u.displayName.split(" ")[0])}</span>
                </div>
            `).join("")}

        </div>
    `;
}

// The bottom nav's "+" — a quick-create hub rather than jumping
// straight to one composer, since there isn't room for a separate
// dedicated button per content type (post/story/track/room) alongside
// the 5 required bottom-nav slots.
function openCreateSheet() {
    showBubblesModal(`
        <div class="modal-header">
            <h3>Создать</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        <div class="profile-menu-list">
            <button class="profile-menu-item" onclick="closeBubblesModal();openCreatePost();">
                <span class="profile-menu-icon">📝</span> Пост
            </button>
            <button class="profile-menu-item" onclick="closeBubblesModal();addStoryPrompt();">
                <span class="profile-menu-icon">📖</span> История
            </button>
            <button class="profile-menu-item" onclick="closeBubblesModal();musicTab='mine';navigate('music');">
                <span class="profile-menu-icon">🎵</span> Трек
            </button>
            <button class="profile-menu-item" onclick="closeBubblesModal();openCreateRoomModal();">
                <span class="profile-menu-icon">🫧</span> Комната
            </button>
        </div>
    `);
}

function openCreatePost() {
    navigate("feed");
    setTimeout(() => {
        const input = document.getElementById("postText");
        input?.scrollIntoView({ behavior: "smooth", block: "center" });
        input?.focus();
    }, 80);
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
        const storyId = uid("story");
        let image;
        try { image = await uploadImageToStorage(file, `${currentUserId}/story-${storyId}.jpg`, 1080); }
        catch (e) { console.error(e); toast("Не удалось загрузить фото."); return; }
        const caption = (prompt("Подпись к истории (необязательно):", "") || "").trim();
        const { data, error } = await sb.from("stories")
            .insert({ id: storyId, author_id: currentUserId, image, caption })
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
    if (!error && data) db.storyViews.push({ id: data.id, storyId: data.story_id, viewerId: data.viewer_id, viewedAt: data.viewed_at ? Date.parse(data.viewed_at) : Date.now() });
}

// Tapback-style, same semantics as post/poll reactions elsewhere —
// tapping your current emoji again removes it, a different one swaps it.
async function toggleStoryReaction(storyId, emoji) {
    const mine = db.storyReactions.find(r => r.storyId === storyId && r.userId === currentUserId);
    const removing = !!mine && mine.emoji === emoji;

    if (removing) db.storyReactions = db.storyReactions.filter(r => !(r.storyId === storyId && r.userId === currentUserId));
    else {
        db.storyReactions = db.storyReactions.filter(r => !(r.storyId === storyId && r.userId === currentUserId));
        db.storyReactions.push({ storyId, userId: currentUserId, emoji, createdAt: Date.now() });
    }
    renderStoryReactionBar();
    if (!removing) haptic("tap");

    const { error } = removing
        ? await sb.from("story_reactions").delete().eq("story_id", storyId).eq("user_id", currentUserId)
        : await sb.from("story_reactions").upsert({ story_id: storyId, user_id: currentUserId, emoji }, { onConflict: "story_id,user_id" });

    if (error) {
        console.error(error);
        toast("Не удалось отправить реакцию.");
    } else if (!removing) {
        const story = db.stories.find(s => s.id === storyId);
        if (story && story.authorId !== currentUserId) createNotification({ userId: story.authorId, type: "story_reaction" });
    }
}

// Re-renders just the reaction row (not the whole overlay) so picking an
// emoji doesn't restart the story's auto-advance timer.
function renderStoryReactionBar() {
    const el = document.getElementById("storyReactionBar");
    if (!el || !storyViewerState) return;
    const stories = storiesByAuthor(storyViewerState.authorId);
    const story = stories[storyViewerState.index];
    if (!story) return;
    const mine = db.storyReactions.find(r => r.storyId === story.id && r.userId === currentUserId);
    el.innerHTML = STORY_REACTIONS.map(emoji => `
        <button type="button" class="story-reaction-btn${mine?.emoji === emoji ? " selected" : ""}" onclick="toggleStoryReaction('${story.id}','${emoji}')">${emoji}</button>
    `).join("");
}

async function sendStoryReply(authorId, storyId) {
    const input = document.getElementById("storyReplyInput");
    const text = input?.value.trim();
    if (!text) return;
    input.value = "";

    const story = db.stories.find(s => s.id === storyId);
    const fullText = `📖 Ответ на историю:\n${text}`;
    const message = { id: uid("message"), from: currentUserId, to: authorId, text: fullText, image: "", createdAt: Date.now(), readAt: null, reactions: [] };
    db.messages.push(message);

    const row = await buildEncryptedMessageRow(message.id, authorId, fullText, "", new Date(message.createdAt).toISOString());
    const { error } = await sb.from("messages").insert(row);
    if (error) {
        console.error(error);
        db.messages = db.messages.filter(m => m.id !== message.id);
        toast("Не удалось отправить ответ.");
        return;
    }
    toast("Ответ отправлен ↪️");
}

// Shown to the story's author — who viewed it and, if they reacted,
// with what. Sorted most-recent-view-first.
function openStoryViewersModal(storyId) {
    const views = db.storyViews.filter(v => v.storyId === storyId).sort((a, b) => b.viewedAt - a.viewedAt);
    showBubblesModal(`
        <div class="modal-header">
            <h3>👁️ Просмотрели</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        ${
            views.length
            ? `
                <div class="profile-menu-list">
                    ${views.map(v => {
                        const user = getUser(v.viewerId);
                        if (!user) return "";
                        const reaction = db.storyReactions.find(r => r.storyId === storyId && r.userId === v.viewerId);
                        return `
                            <button class="profile-menu-item" onclick="closeBubblesModal();navigate('profile','${user.id}')">
                                <img loading="lazy" decoding="async" class="mini-avatar" src="${user.avatar || defaultAvatar()}">
                                <span style="flex:1;">${escapeHtml(user.displayName)}</span>
                                ${reaction ? `<span>${reaction.emoji}</span>` : ""}
                                <small style="color:var(--muted);">${timeAgo(v.viewedAt)}</small>
                            </button>
                        `;
                    }).join("")}
                </div>
              `
            : `<p style="text-align:center;color:var(--muted);padding:16px 0;">Пока никто не посмотрел.</p>`
        }
    `);
}

async function deleteCurrentStory() {
    if (!storyViewerState) return;
    const stories = storiesByAuthor(storyViewerState.authorId);
    const story = stories[storyViewerState.index];
    if (!story || story.authorId !== currentUserId) return;
    if (!confirm("Удалить эту историю?")) return;
    const { error } = await sb.from("stories").delete().eq("id", story.id);
    if (error) { console.error(error); toast("Не удалось удалить историю."); return; }
    sb.storage.from(IMAGES_BUCKET).remove([`${story.authorId}/story-${story.id}.jpg`]).catch(() => {});
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
    const reactionCount = isMine ? db.storyReactions.filter(r => r.storyId === story.id).length : 0;
    const myReaction = db.storyReactions.find(r => r.storyId === story.id && r.userId === currentUserId);

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
                <img loading="lazy" decoding="async" class="story-ring-avatar small" src="${author?.avatar || defaultAvatar()}">
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

            ${
                isMine
                ? `
                    <div class="story-view-count" onclick="openStoryViewersModal('${story.id}')" style="cursor:pointer;">
                        👁️ ${viewCount}${reactionCount ? ` · ❤️ ${reactionCount}` : ""}
                    </div>
                `
                : `
                    <div class="story-footer">
                        <div id="storyReactionBar" class="story-reaction-bar">
                            ${STORY_REACTIONS.map(emoji => `
                                <button type="button" class="story-reaction-btn${myReaction?.emoji === emoji ? " selected" : ""}" onclick="toggleStoryReaction('${story.id}','${emoji}')">${emoji}</button>
                            `).join("")}
                        </div>
                        <div class="story-reply-row">
                            <input
                                id="storyReplyInput"
                                placeholder="Ответить на историю..."
                                onfocus="if(storyViewerState?.timer)clearTimeout(storyViewerState.timer);"
                                onkeydown="if(event.key==='Enter')sendStoryReply('${story.authorId}','${story.id}')"
                            >
                            <button type="button" onclick="sendStoryReply('${story.authorId}','${story.id}')">➤</button>
                        </div>
                    </div>
                `
            }

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

// Short vibration on satisfying/confirming moments (like, send,
// achievement unlock) — makes the app feel more like a native one on
// phones that support it. Silently does nothing everywhere else
// (desktop browsers, iOS Safari — neither implements the Vibration
// API), so this is always safe to call without a feature check at the
// call site. "tap"/"success"/"achievement" are just named intensities.
function haptic(kind = "tap") {
    if (!navigator.vibrate) return;
    const patterns = { tap: 10, success: [12, 30, 12], achievement: [15, 40, 15, 40, 25] };
    navigator.vibrate(patterns[kind] ?? patterns.tap);
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

function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

// Resizes + uploads a picked file to the images bucket in one go, and
// returns its public URL — the row then just stores that URL instead of
// the full base64 image inline. `path` is deterministic (based on the
// user + post/story id, or just "avatar"/"cover"), so re-uploading the
// same thing naturally overwrites the old file instead of piling up
// orphaned ones in Storage.
async function uploadImageToStorage(file, path, maxDimension) {
    const dataUrl = await resizeImageFile(file, maxDimension);
    const blob = dataUrlToBlob(dataUrl);
    const { error } = await sb.storage.from(IMAGES_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    return sb.storage.from(IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Для картинок, которые уже прошли через кроппер (js/image-cropper.js) —
// они уже нужного размера и соотношения сторон, повторный ресайз не нужен.
// GIF-аватарки идут сюда же как есть (без кроппера — canvas убивает
// анимацию), поэтому contentType настраиваемый, а не всегда JPEG.
async function uploadBlobToStorage(blob, path, contentType = "image/jpeg") {
    const { error } = await sb.storage.from(IMAGES_BUCKET).upload(path, blob, { contentType, upsert: true });
    if (error) throw error;
    return sb.storage.from(IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
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
    if(!currentUserId || document.visibilityState !== "visible") return;
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
    heartbeatTimer = setInterval(updateLastSeen,45000);
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

// Same three-way Russian pluralization as pluralPeople above, just for
// "голос/голоса/голосов" (poll vote counts) instead of "человек".
function pluralVotes(n){
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "голос";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "голоса";
    return "голосов";
}

// Polls everyone's last_seen periodically so the "N онлайн" badge (topbar
// + landing screen) stays roughly live without needing a dedicated
// realtime presence channel. Computes the count straight from the query
// result (not db.users) so it also works pre-login on the landing screen,
// where db.users is still empty.
/* ------------------------------------------------------------
   BUBBLES NOW — small live pulse at the top of the feed. Everything
   here is computed from data already in memory (db.posts/users/rooms/
   roomMembers) — no extra queries beyond the existing online-count
   poll below, which this piggybacks on for its refresh timer. Only
   ever shows counts and first names/track titles people already chose
   to make public — nothing private.
   ------------------------------------------------------------ */
function bubblesNowStats() {
    const onlineUsers = db.users.filter(u => isUserOnline(u.lastSeen));
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const newPosts = db.posts.filter(p => (p.wallOwnerId || p.authorId) === p.authorId && p.createdAt > hourAgo).length;
    const activeRooms = db.rooms.filter(r => roomOnlineCount(r.id) > 0).length;
    const listening = onlineUsers.filter(u => u.currentTrack);
    return { onlineCount: onlineUsers.length, newPosts, activeRooms, listening };
}

// Real posts and room-joins have real timestamps and interleave by
// recency; who's listening right now doesn't have a "started at" (see
// setListening — it's a status, not an event), so that's its own single
// summary line instead of being forced into fake per-person timestamps.
function bubblesNowEvents() {
    const events = [];
    const publicPosts = db.posts
        .filter(p => (p.wallOwnerId || p.authorId) === p.authorId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5);
    publicPosts.forEach(p => {
        const author = getUser(p.authorId);
        if (author) events.push({ at: p.createdAt, text: `📝 ${escapeHtml(author.displayName)} опубликовал(а) пост` });
    });

    const recentCutoff = Date.now() - 15 * 60 * 1000;
    db.roomMembers
        .filter(m => m.createdAt > recentCutoff)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .forEach(m => {
            const user = getUser(m.userId);
            const room = db.rooms.find(r => r.id === m.roomId);
            if (user && room) events.push({ at: m.createdAt, text: `🫧 ${escapeHtml(user.displayName)} вошёл(-а) в «${escapeHtml(room.name)}»` });
        });

    return events.sort((a, b) => b.at - a.at).slice(0, 6);
}

function timeAgoShort(timestamp) {
    const diff = Math.max(0, Date.now() - timestamp);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "только что";
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} дн назад`;
}

function bubblesNowWidgetHtml() {
    const stats = bubblesNowStats();
    const events = bubblesNowEvents();
    return `
        <div id="bubblesNowWidget" class="bubbles-now-card">
            <div class="bubbles-now-header">🫧 Bubbles Now</div>
            <div class="bubbles-now-stats">
                <div class="bubbles-now-stat"><strong>${stats.onlineCount}</strong><span>онлайн</span></div>
                <div class="bubbles-now-stat"><strong>${stats.newPosts}</strong><span>новых постов</span></div>
                <div class="bubbles-now-stat"><strong>${stats.activeRooms}</strong><span>активных комнат</span></div>
                <div class="bubbles-now-stat"><strong>${stats.listening.length}</strong><span>слушают музыку</span></div>
            </div>
            ${
                stats.listening.length
                ? `<div class="bubbles-now-listening">🎧 ${stats.listening.slice(0, 3).map(u => escapeHtml(u.displayName)).join(", ")}${stats.listening.length > 3 ? ` и ещё ${stats.listening.length - 3}` : ""} сейчас слушают музыку</div>`
                : ""
            }
            ${
                events.length
                ? `<div class="bubbles-now-events">${events.map(e => `<div class="bubbles-now-event"><span>${e.text}</span><small>${timeAgoShort(e.at)}</small></div>`).join("")}</div>`
                : ""
            }
        </div>
    `;
}

function refreshBubblesNowWidget() {
    const el = document.getElementById("bubblesNowWidget");
    if (!el) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = bubblesNowWidgetHtml().trim();
    el.replaceWith(wrapper.firstElementChild);
}

async function refreshOnlineCount(){
    if(document.visibilityState !== "visible") return;
    try{
        // Was a direct .gte("last_seen", cutoff) head-count against the
        // raw profiles table — moved to a security-definer RPC instead
        // so a bare aggregate count doesn't need the client to filter
        // on last_seen directly (see online_users_count in supabase.sql).
        const { data: count, error } = await sb.rpc("online_users_count");
        if(error) throw error;
        const safeCount = Number(count) || 0;
        const topbarBadge = document.getElementById("topbarOnlineCount");
        if(topbarBadge) topbarBadge.textContent = `🟢 ${safeCount} онлайн`;
        const landingBadge = document.getElementById("landingOnlineCount");
        if(landingBadge) landingBadge.textContent = `🟢 ${safeCount} ${pluralPeople(safeCount)} сейчас в bubbles`;
        refreshBubblesNowWidget();
    }catch(error){
        console.error("Не удалось обновить счётчик онлайн:", error);
    }
}

function startOnlineCountPolling(){
    refreshOnlineCount();
    if(onlineCountTimer) return;
    onlineCountTimer = setInterval(refreshOnlineCount, 60000);
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
            <button id="loginSubmitBtn" class="primary full">Войти в bubbles</button>
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
            <button id="registerSubmitBtn" class="primary full">Создать аккаунт</button>
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

let isRegistering = false;
async function register(event) {
    event.preventDefault();
    if (isRegistering) return;
    isRegistering = true;
    const btn = document.getElementById("registerSubmitBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Создаём…"; }
    try {
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
    } finally {
        isRegistering = false;
        const btnAgain = document.getElementById("registerSubmitBtn");
        if (btnAgain) { btnAgain.disabled = false; btnAgain.textContent = "Создать аккаунт"; }
    }
}

let isLoggingIn = false;
async function login(event) {
    event.preventDefault();
    if (isLoggingIn) return;
    isLoggingIn = true;
    const btn = document.getElementById("loginSubmitBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Входим…"; }
    try {
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
    } finally {
        isLoggingIn = false;
        // A successful login navigates away from this form entirely
        // (showAuth/bootstrapSession replace the screen), so the button
        // only needs resetting on the failure paths above.
        const btnAgain = document.getElementById("loginSubmitBtn");
        if (btnAgain) { btnAgain.disabled = false; btnAgain.textContent = "Войти в bubbles"; }
    }
}

async function logout(){
    stopPresenceHeartbeat();
    stopPetHeartbeat();
    stopOnlineCountPolling();
    teardownRealtime();
    closeMusicPlayer();
    document.documentElement.removeAttribute("data-sub-theme");
    await sb.auth.signOut();
    currentUserId = null;
    teardownCallSignaling();
    selectedCanvasUserId = null;
    canvasBackground = "sky";
    db = {users:[],posts:[],comments:[],friends:[],friendRequests:[],notifications:[],messages:[],music:[],reports:[],subscriptionRequests:[],blocks:[],stories:[],storyViews:[],canvasItems:[],pet:null};
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
    applySubscriptionTheme(me);
    setupMessagesRealtime();
    setupFriendRequestsRealtime();
    setupSocialRealtime();
    setupNotificationsRealtime();
    initCallSignaling();
    // Resolve a shared profile link (#u-<username>), if present, before
    // the initial render — see shareProfile. Left un-cleared afterwards
    // so refreshing the page keeps working, same as any other deep link.
    const sharedMatch = location.hash.match(/^#u-(.+)$/);
    if (sharedMatch) {
        const sharedUser = db.users.find(u => u.username === decodeURIComponent(sharedMatch[1]));
        if (sharedUser) {
            currentPage = "profile";
            selectedProfileId = sharedUser.id;
        }
    }
    renderApp();
    startOnlineCountPolling();
    // On iPhone/iPad, Web Push permission MUST be requested from a direct
    // user gesture. If permission was already granted, silently restore the
    // subscription; otherwise the Settings button will ask at the right time.
    subscribeToPush({ requestPermission: false });
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

                <button
                    class="mobile-more-btn"
                    onclick="toggleMoreSheet()"
                    title="Ещё"
                >
                    ⋯
                    <span id="moreSheetDot" class="bottom-nav-dot hidden"></span>
                </button>

                <img
                    class="mini-avatar${avatarFrameClass(user)}"
                    src="${user.avatar || defaultAvatar()}"
                >

                <span>
                    ${escapeHtml(user.displayName)} ${subBadge(user)}
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

                <!--
                    The less-frequently-used pages fold under here instead
                    of sitting alongside the 5 daily-driver ones above —
                    same "5 primary + everything else tucked away" idea as
                    the mobile bottom-nav's "Ещё" sheet, just as an inline
                    accordion here since desktop has room to expand in
                    place rather than needing a whole separate sheet.
                    sidebarMoreExpanded starts true when you're already ON
                    one of these pages, so the active tab is never hidden
                    behind a collapsed toggle.
                -->
                <button
                    class="nav-btn sidebar-more-toggle"
                    onclick="toggleSidebarMore()"
                >
                    ${sidebarMoreExpanded ? "▾" : "▸"} Ещё
                </button>

                <div class="sidebar-more ${sidebarMoreExpanded ? "" : "hidden"}">

                    <button
                        class="nav-btn"
                        data-page="search"
                        onclick="navigate('search')"
                    >
                        🔎 Поиск
                    </button>

                    <button
                        class="nav-btn"
                        data-page="rooms"
                        onclick="navigate('rooms')"
                    >
                        🎨 Комната
                    </button>

                    <button
                        class="nav-btn"
                        data-page="groupRooms"
                        onclick="navigate('groupRooms')"
                    >
                        🫧 Комнаты
                    </button>

                    <button
                        class="nav-btn"
                        data-page="saved"
                        onclick="navigate('saved')"
                    >
                        🔖 Сохранённое
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
                        data-page="premium"
                        onclick="navigate('premium')"
                    >
                        💎 Bubbles+
                    </button>

                    <button
                        class="nav-btn"
                        data-page="edit"
                        onclick="navigate('edit')"
                    >
                        ⚙️ Настройки
                    </button>

                </div>

            </aside>


            <main
                id="page"
                class="content"
            ></main>

        </div>

        <!--
            Bottom tab bar — mobile only (see the max-width:850px rule in
            css). Same reasoning as #notifPanel above: kept OUTSIDE
            .layout/.sidebar as a plain sibling so position:fixed is
            never at risk of getting trapped inside some ancestor's
            stacking context.

            Reuses [data-page] on purpose — navigate() already toggles
            .active on every element with that attribute, so these
            buttons get "which tab is active" highlighting for free
            without any extra JS.
        -->
        <nav class="bottom-nav">

            <button class="bottom-nav-btn" data-page="feed" onclick="navigate('feed')">
                <span class="bottom-nav-icon">🏠</span>
                <span class="bottom-nav-label">Главная</span>
            </button>

            <button class="bottom-nav-btn" data-page="search" onclick="navigate('search')">
                <span class="bottom-nav-icon">🔎</span>
                <span class="bottom-nav-label">Поиск</span>
            </button>

            <button class="bottom-nav-btn bottom-nav-create" onclick="openCreateSheet()">
                <span class="bottom-nav-icon">➕</span>
                <span class="bottom-nav-label">Создать</span>
            </button>

            <button class="bottom-nav-btn" data-page="messages" onclick="navigate('messages')">
                <span class="bottom-nav-icon">💬</span>
                <span class="bottom-nav-label">Сообщения</span>
                <span id="messagesUnreadBadgeMobile" class="nav-badge bottom-nav-badge hidden"></span>
            </button>

            <button class="bottom-nav-btn" data-page="profile" onclick="navigate('profile')">
                <span class="bottom-nav-icon">👤</span>
                <span class="bottom-nav-label">Профиль</span>
                <span id="pendingReportsBadgeMobile" class="nav-badge bottom-nav-badge hidden"></span>
            </button>

        </nav>

        <div id="moreSheetOverlay" class="more-sheet-overlay hidden" onclick="if(event.target===this) closeMoreSheet()">
            <div class="more-sheet">

                <div class="more-sheet-handle"></div>

                <button class="more-sheet-item" data-page="friends" onclick="navigate('friends'); closeMoreSheet();">
                    🫂 Друзья
                    <span id="friendRequestsBadgeMobile" class="nav-badge hidden"></span>
                </button>

                <button class="more-sheet-item" data-page="music" onclick="navigate('music'); closeMoreSheet();">
                    🎵 Музыка
                </button>

                <button class="more-sheet-item" data-page="rooms" onclick="navigate('rooms'); closeMoreSheet();">
                    🎨 Комната
                </button>

                <button class="more-sheet-item" data-page="groupRooms" onclick="navigate('groupRooms'); closeMoreSheet();">
                    🫧 Комнаты
                </button>

                <button class="more-sheet-item" data-page="saved" onclick="navigate('saved'); closeMoreSheet();">
                    🔖 Сохранённое
                </button>

                <button class="more-sheet-item" data-page="pet" onclick="navigate('pet'); closeMoreSheet();">
                    🐣 Питомец
                    <span id="petNeedsAttentionBadgeMobile" class="nav-badge hidden"></span>
                </button>

                <button class="more-sheet-item" data-page="premium" onclick="navigate('premium'); closeMoreSheet();">
                    💎 Bubbles+
                </button>

                <button class="more-sheet-item" data-page="edit" onclick="navigate('edit'); closeMoreSheet();">
                    ⚙️ Настройки
                </button>

            </div>
        </div>

    `;

    navigate(currentPage);
    updateNavBadges();
}

function toggleMoreSheet() {
    const overlay = document.getElementById("moreSheetOverlay");
    if (!overlay) return;
    overlay.classList.contains("hidden") ? openMoreSheet() : closeMoreSheet();
}

function openMoreSheet() {
    document.getElementById("moreSheetOverlay")?.classList.remove("hidden");
}

function closeMoreSheet() {
    document.getElementById("moreSheetOverlay")?.classList.add("hidden");
}

/* ============================================================
   NAVIGATION
   ============================================================ */

function navigate(page, id = null){
    const isFreshEntryToFeed = page === "feed" && currentPage !== "feed";
    const isFreshEntryToRooms = page === "rooms" && currentPage !== "rooms";
    currentPage = page;
    selectedProfileId = id || selectedProfileId;
    closeStoryViewer(); // it's a full-screen modal appended to <body>, outside the normal page — don't leave it floating over the newly navigated-to page
    closeMoreSheet();
    stopCallSettingsPreview(); // release any mic/camera test started from the Settings page before leaving it
    stopTelegramLinkPolling(); // stop polling for a Telegram link confirmation if we're navigating away from Settings

    // Keeps the desktop sidebar's collapsed "Ещё" section from hiding
    // its own active tab when one of its pages is reached some other
    // way than clicking it there directly — e.g. the "🎨 Комната"
    // button on someone's profile. navigate() only ever rebuilds #page,
    // not the sidebar itself, so the state flag alone wouldn't be
    // reflected on screen without also touching the DOM directly here.
    if (["friends","music","rooms","groupRooms","roomChat","saved","pet","premium","edit"].includes(page) && !sidebarMoreExpanded) {
        sidebarMoreExpanded = true;
        document.querySelector(".sidebar-more")?.classList.remove("hidden");
        const toggle = document.querySelector(".sidebar-more-toggle");
        if (toggle) toggle.textContent = "▾ Ещё";
    }

    document.querySelectorAll("[data-page]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === page);
    });

    // Only reset the feed's pagination when actually ARRIVING at it from
    // somewhere else — navigate("feed") also fires for incidental
    // whole-app re-renders (e.g. an achievement toast) while you're
    // already sitting in the feed, and collapsing everything you'd
    // scrolled through back down to 20 posts in that case would be
    // exactly the jarring reset "load more" is meant to avoid.
    if (isFreshEntryToFeed) feedVisibleCount = FEED_PAGE_SIZE;

    // Same idea for rooms: the bottom-nav "Комнаты" tab always means
    // "take me to MY OWN room", but an incidental re-render while
    // already sitting in a room (yours or a visited one) shouldn't
    // silently refetch and potentially flicker mid-edit. openCanvasRoom
    // renders itself once its fetch resolves, so the switch below just
    // skips rendering rooms synchronously in that one case. A skeleton
    // goes up immediately so the screen doesn't just sit frozen on
    // whatever page was open before while that fetch is in flight.
    if (isFreshEntryToRooms) {
        renderCanvasRoomSkeleton();
        openCanvasRoom(currentUserId);
    }

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
        case "rooms": if (!isFreshEntryToRooms) renderRooms(); break;
        case "groupRooms": renderGroupRoomsList(); break;
        case "roomChat": openRoomChat(id); break;
        case "playlist": renderPlaylistPage(id); break;
        case "music": renderMusic(); break;
        case "pet": renderPet(); break;
        case "premium": renderPremium(); break;
        case "edit": renderEditProfile(); break;
        case "search": renderSearchResults((id != null ? id : userSearchQuery).trim().toLowerCase()); break;
        case "saved": renderSaved(); break;
        default: renderFeed();
    }

    stopWatchingChatPartnerPresence();
    if (page === "messages" && selectedChatId) watchChatPartnerPresence(selectedChatId);

    // Small fade+rise on every page switch — ties tab changes together
    // visually instead of content just snapping into place. See
    // replayPageTransition() for why it's a remove/reflow/re-add.
    replayPageTransition();

    updateNavBadges();
}

// Reused by tab-switch functions within a page (profile/music/search/
// notifications) that rewrite #page's content directly rather than
// going through navigate() — same fade+rise, retriggered by removing
// the class, forcing a reflow, then re-adding it, since a CSS animation
// won't restart on its own just because #page's innerHTML changed
// underneath it.
function replayPageTransition() {
    const pageEl = document.getElementById("page");
    if (!pageEl) return;
    pageEl.classList.remove("page-transition");
    void pageEl.offsetWidth;
    pageEl.classList.add("page-transition");
}

/* ============================================================
   FEED
   ============================================================ */

let feedVisibleCount = 20;
const FEED_PAGE_SIZE = 20;

function renderFeed(){
    const page = document.getElementById("page");
    // Pinned posts (max 2, enforced in the DB) always lead the feed,
    // most-recently-pinned first; everything else follows in normal
    // newest-first order.
    //
    // Wall posts (someone writing directly on a FRIEND's wall, not
    // their own) are deliberately excluded here — they used to show up
    // in the main feed with no indication of what they actually were,
    // indistinguishable from a normal post. The wall is its own place
    // now (see the profile page); the main feed is just what people
    // post about themselves. wallOwnerId defaults to authorId for
    // regular/self posts (see rowToPost), so this check is simply
    // "was this posted on someone else's wall".
    const posts = [...db.posts]
        .filter(p => (p.wallOwnerId || p.authorId) === p.authorId)
        .sort((a,b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            if (a.pinned && b.pinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
            return b.createdAt - a.createdAt;
        });
    const visible = posts.slice(0, feedVisibleCount);
    const hasMore = posts.length > visible.length;

    page.innerHTML = `

        <h1 class="section-title">
            🫧 Лента
        </h1>

        ${renderStoryRail()}

        ${bubblesNowWidgetHtml()}


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
                    type="button"
                    class="secondary"
                    onclick="togglePollComposer()"
                >
                    📊 Опрос
                </button>

                <button
                    id="createPostBtn"
                    class="primary"
                    onclick="createPost()"
                >
                    Опубликовать
                </button>

            </div>

            <div id="composerMusicChip"></div>

            <div id="pollComposerBuilder" class="poll-composer-builder hidden">

                <div id="pollOptionInputs">
                    <input class="poll-option-input" maxlength="80" placeholder="Вариант 1">
                    <input class="poll-option-input" maxlength="80" placeholder="Вариант 2">
                </div>

                <div class="poll-composer-actions">
                    <button type="button" class="secondary" onclick="addPollOptionInput()">+ Вариант</button>
                    <button type="button" class="secondary" onclick="togglePollComposer()">✕ Убрать опрос</button>
                </div>

            </div>

        </div>


        <div id="feedPostsList">
            ${
                visible.length
                ? visible.map(renderPost).join("")
                : emptyState(
                    "🌊",
                    "Лента пока пустая",
                    "Опубликуй что-нибудь первым."
                )
            }
        </div>

        ${
            hasMore
            ? `
                <button id="feedLoadMoreBtn" class="secondary full profile-expand-btn" onclick="loadMoreFeedPosts()">
                    Показать ещё (осталось ${posts.length - visible.length})
                </button>
              `
            : ""
        }

    `;

    renderComposerMusicChip();
}

// Appends the next batch straight into the DOM instead of calling
// renderFeed() again — a full page.innerHTML rebuild would blow away
// everything above the button (story rail, composer, all the posts
// already on screen) and reset scroll to the top, which is exactly
// the annoying thing "load more" is supposed to avoid.
function loadMoreFeedPosts(){
    const posts = [...db.posts].sort((a,b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.pinned && b.pinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
        return b.createdAt - a.createdAt;
    });
    const nextBatch = posts.slice(feedVisibleCount, feedVisibleCount + FEED_PAGE_SIZE);
    const list = document.getElementById("feedPostsList");
    if (list && nextBatch.length) list.insertAdjacentHTML("beforeend", nextBatch.map(renderPost).join(""));
    feedVisibleCount += nextBatch.length;

    const remaining = posts.length - feedVisibleCount;
    const btn = document.getElementById("feedLoadMoreBtn");
    if (btn) {
        if (remaining > 0) btn.textContent = `Показать ещё (осталось ${remaining})`;
        else btn.remove();
    }
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

            <img loading="lazy" decoding="async"
                class="mini-avatar small comment-avatar${avatarFrameClass(user)}"
                src="${user?.avatar || defaultAvatar()}"
                ${user ? `onclick="${goToProfile}" style="cursor:pointer"` : ""}
            >

            <div class="comment-body">

                <strong
                    ${user ? `onclick="${goToProfile}" style="cursor:pointer"` : ""}
                >
                    ${escapeHtml(user?.displayName || "Пользователь")} ${user ? subBadge(user, { fontSize: "9px" }) : ""}
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

// Renders one poll's options as tap-to-vote bars — percentage fill grows
// once votes exist, "mine" gets a highlighted border, and the count/%
// only appear once at least one vote has been cast (before that it's
// just a plain list of choices, nothing to compare yet).
function renderPollCard(poll, options){
    const totalVotes = options.reduce((sum, o) => sum + o.votes.length, 0);
    const myOptionId = options.find(o => o.votes.includes(currentUserId))?.id || null;
    return `
        <div class="poll-card">
            ${
                options.map(option => {
                    const pct = totalVotes ? Math.round((option.votes.length / totalVotes) * 100) : 0;
                    const mine = option.id === myOptionId;
                    return `
                        <button
                            type="button"
                            class="poll-option${mine ? " mine" : ""}"
                            onclick="voteInPoll('${poll.id}','${option.id}')"
                        >
                            <div class="poll-option-fill" style="width:${pct}%"></div>
                            <span class="poll-option-text">${mine ? "✓ " : ""}${escapeHtml(option.text)}</span>
                            ${totalVotes ? `<span class="poll-option-pct">${pct}%</span>` : ""}
                        </button>
                    `;
                }).join("")
            }
            <div class="poll-meta">${totalVotes} ${pluralVotes(totalVotes)}</div>
        </div>
    `;
}

function renderPost(post){
    const author = getUser(post.authorId);
    if(!author) return "";
    // Group the flat reactions list (one row per person) into
    // emoji -> [userIds], same trick as messageBubble's grouping, so two
    // people reacting with the same emoji show as one pill with a count.
    const reactions = post.reactions || [];
    const groupedReactions = new Map();
    reactions.forEach(r => {
        if (!groupedReactions.has(r.emoji)) groupedReactions.set(r.emoji, []);
        groupedReactions.get(r.emoji).push(r.userId);
    });
    const allComments = db.comments.filter(c => c.postId === post.id).sort((a,b) => a.createdAt - b.createdAt);
    const topComments = allComments.filter(c => !c.parentId);
    const repliesByParent = new Map();
    allComments.filter(c => c.parentId).forEach(c => {
        if (!repliesByParent.has(c.parentId)) repliesByParent.set(c.parentId, []);
        repliesByParent.get(c.parentId).push(c);
    });
    const comments = allComments; // total count (incl. replies) for the 💬 button
    const poll = db.polls.find(p => p.postId === post.id);
    const pollOptions = poll ? db.pollOptions.filter(o => o.pollId === poll.id).sort((a, b) => a.position - b.position) : [];

    return `

        <article
    class="card post ${post.pinned ? "post-pinned" : ""} ${post.id === justAddedPostId ? "post-appear" : ""}"
    data-bubbles-post-id="${post.id}"
>

            ${post.pinned ? `<div class="pinned-badge">📌 Закреплено</div>` : ""}

            <div class="post-head">

                <img loading="lazy" decoding="async"
                    class="mini-avatar${avatarFrameClass(author)}"
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
                    ${subBadge(author, { fontSize: "9px" })}

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


            ${poll ? renderPollCard(poll, pollOptions) : ""}


            ${
                post.image
                ? `
                    <img loading="lazy" decoding="async"
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

                <div class="post-reactions">

                    ${
                        [...groupedReactions.entries()].map(([emoji, userIds]) => `
                            <button
                                type="button"
                                class="post-reaction-pill${userIds.includes(currentUserId) ? " mine" : ""}"
                                onclick="toggleReaction('${post.id}','${emoji}')"
                                title="${userIds.length}"
                            >
                                ${emoji}${userIds.length > 1 ? `<span>${userIds.length}</span>` : ""}
                            </button>
                        `).join("")
                    }

                    <button
                        type="button"
                        class="post-reaction-add-btn"
                        onclick="togglePostReactionPicker(event,'${post.id}')"
                        title="Добавить реакцию"
                    >🙂</button>

                    <div class="post-reaction-picker hidden">
                        ${
                            POST_REACTIONS.map(emoji => `
                                <button
                                    type="button"
                                    onclick="toggleReaction('${post.id}','${emoji}');closeReactionPickers();"
                                >
                                    ${emoji}
                                </button>
                            `).join("")
                        }
                    </div>

                </div>


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


                <button
                    class="action-btn ${mySavedPostIds.has(post.id) ? "saved" : ""}"
                    onclick="toggleSavePost('${post.id}')"
                    title="${mySavedPostIds.has(post.id) ? "Убрать из сохранённого" : "Сохранить"}"
                >
                    🔖
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
                    isAdmin()
                    ? `
                        <button
                            class="action-btn"
                            onclick="togglePinPost('${post.id}')"
                            title="${post.pinned ? "Открепить" : "Закрепить"}"
                        >
                            ${post.pinned ? "📌" : "📍"}
                        </button>
                    `
                    : ""
                }

                ${
                    post.authorId === currentUserId || post.wallOwnerId === currentUserId || isAdmin()
                    ? `
                        <button
                            class="action-btn"
                            onclick="deletePost('${post.id}')"
                            title="${post.authorId === currentUserId ? "Удалить" : (post.wallOwnerId === currentUserId ? "Удалить со стены" : "Удалить (админ)" )}"
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

let isCreatingPost = false;
// Marks whichever post should play the "just appeared" animation on its
// very next render — cleared right after so liking/commenting/editing
// that same post later doesn't replay it. See renderPost's post-appear
// class and the reduced-motion-respecting keyframe in style.css.
let justAddedPostId = null;
async function createPost(targetWallId = null) {
    if (isCreatingPost) return; // guards against a double-tap firing this twice while the upload/insert is still in flight — would otherwise post it twice
    const text = document.getElementById("postText")?.value.trim() || "";
    const file = document.getElementById("postImage")?.files[0];
    const pollOptionsText = readPollOptionsFromComposer();
    if (pollOptionsText.length === 1) {
        toast("Добавь ещё хотя бы один вариант ответа для опроса.");
        return;
    }
    if (!text && !file && !selectedComposerMusicId && pollOptionsText.length < 2) {
        toast("Добавь текст, изображение, музыку или опрос.");
        return;
    }
    isCreatingPost = true;
    const btn = document.getElementById("createPostBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Публикуем…"; }
    try {
        const postId = uid("post");
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
            try { image = await uploadImageToStorage(file, `${currentUserId}/post-${postId}.jpg`, 1600); }
            catch (e) { console.error(e); toast("Не удалось загрузить изображение."); return; }
        }
        const musicId = selectedComposerMusicId || null;
        const wallOwnerId = targetWallId || currentUserId;
        const post = { id: postId, authorId: currentUserId, wallOwnerId, text, image, musicId, sharedPostId: null, likes: [], reactions: [], createdAt: Date.now() };
        justAddedPostId = post.id;
        db.posts.unshift(post);
        setTimeout(() => { if (justAddedPostId === post.id) justAddedPostId = null; }, 600);
        const { error } = await sb.from("posts").insert({
            id: post.id, author_id: post.authorId, wall_owner_id: post.wallOwnerId, text: post.text, image: post.image, music_id: post.musicId, likes: [], created_at: new Date(post.createdAt).toISOString()
        });
        if (error) {
            db.posts = db.posts.filter(p => p.id !== post.id);
            console.error(error);
            toast("Не удалось опубликовать пост.");
            return;
        }
        if (pollOptionsText.length >= 2) {
            const pollId = uid("poll");
            const { error: pollError } = await sb.from("polls").insert({ id: pollId, post_id: postId });
            if (pollError) {
                // The post itself is already live at this point — losing just
                // the poll attachment isn't worth rolling the whole post back
                // for, so this only warns rather than deleting post.
                console.error(pollError);
                toast("Пост опубликован, но не удалось добавить опрос.");
            } else {
                const optionRows = pollOptionsText.map((optText, i) => ({ id: uid("plopt"), poll_id: pollId, text: optText, position: i }));
                const { error: optionsError } = await sb.from("poll_options").insert(optionRows);
                if (optionsError) {
                    console.error(optionsError);
                    toast("Пост опубликован, но не удалось добавить варианты опроса.");
                } else {
                    db.polls.push({ id: pollId, postId, createdAt: Date.now() });
                    db.pollOptions.push(...optionRows.map(row => ({ id: row.id, pollId: row.poll_id, text: row.text, position: row.position, votes: [] })));
                }
            }
        }
        // Hide + reset the builder if it was used (leaves it alone,
        // still hidden, if this post never touched it).
        document.getElementById("pollComposerBuilder")?.classList.add("hidden");
        resetPollComposerInputs();
        selectedComposerMusicId = null;
        wallTargetUserId = null;
        toast(targetWallId && targetWallId !== currentUserId ? "Пост опубликован на стене!" : "Пост опубликован!");
        haptic("success");
        recomputeAchievements();
        if (targetWallId) { createNotification({ userId: targetWallId, type: "wall_post", postId }); renderProfile(targetWallId); }
        else renderFeed();
    } finally {
        isCreatingPost = false;
        // renderFeed() (on success) rebuilds the whole composer card anyway,
        // so the button no longer exists to re-enable — this only matters
        // for the early-return/error paths where the old card is still on screen.
        const btnAgain = document.getElementById("createPostBtn");
        if (btnAgain) { btnAgain.disabled = false; btnAgain.textContent = "Опубликовать"; }
    }
}

async function createWallPost(userId){
    wallTargetUserId = userId;
    const text = document.getElementById("wallPostText")?.value?.trim() || "";
    const fileInput = document.getElementById("wallPostImage");
    const file = fileInput?.files?.[0] || null;
    const oldText = document.getElementById("postText");
    const oldImage = document.getElementById("postImage");
    const oldChip = document.getElementById("composerMusicChip");
    const oldBtn = document.getElementById("createPostBtn");
    const wallBtn = document.getElementById("wallCreatePostBtn");
    const musicId = selectedComposerMusicId;
    if (!text && !file && !musicId){ toast("Добавь текст, изображение или музыку."); return; }
    if (wallBtn){ wallBtn.disabled = true; wallBtn.textContent = "Публикуем…"; }
    try {
        // Reuse the hardened upload/validation path from the normal composer.
        let image = "";
        const postId = uid("post");
        if (file){
            if (!file.type.startsWith("image/")){ toast("Можно загружать только изображения."); return; }
            if (file.size > 20 * 1024 * 1024){ toast("Изображение слишком большое. Максимум 20 МБ."); return; }
            image = await uploadImageToStorage(file, `${currentUserId}/post-${postId}.jpg`, 1600);
        }
        const post = { id: postId, authorId: currentUserId, wallOwnerId: userId, text, image, musicId: musicId || null, sharedPostId: null, likes: [], reactions: [], createdAt: Date.now() };
        const { error } = await sb.from("posts").insert({
            id: post.id, author_id: post.authorId, wall_owner_id: post.wallOwnerId, text: post.text, image: post.image, music_id: post.musicId, likes: [], created_at: new Date(post.createdAt).toISOString()
        });
        if (error) throw error;
        justAddedPostId = post.id;
        db.posts.unshift(post);
        setTimeout(() => { if (justAddedPostId === post.id) justAddedPostId = null; }, 600);
        selectedComposerMusicId = null;
        wallTargetUserId = null;
        recomputeAchievements();
        toast(userId === currentUserId ? "Пост опубликован на стене!" : "Сообщение оставлено на стене!");
        renderProfile(userId);
    } catch (e){
        console.error(e);
        toast("Не удалось опубликовать пост на стене.");
    } finally {
        if (wallBtn) { wallBtn.disabled = false; wallBtn.textContent = "Опубликовать"; }
    }
}

function renderWallComposerMusicChip(){
    const el = document.getElementById("wallComposerMusicChip");
    if (!el) return;
    if (!selectedComposerMusicId){ el.innerHTML = ""; return; }
    const track = db.music.find(m => m.id === selectedComposerMusicId);
    if (!track){ selectedComposerMusicId = null; el.innerHTML = ""; return; }
    el.innerHTML = `<div class="composer-music-chip">🎵 <span>${escapeHtml(track.title)}</span><button type="button" class="message-image-remove" onclick="removeComposerMusic()" title="Убрать трек">✕</button></div>`;
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

// Generalized like/reaction: tapping an emoji you haven't picked yet sets
// it (replacing any previous emoji of yours on this post), tapping your
// own current emoji again removes it — same tapback semantics as
// toggleMessageReaction. post.likes stays "everyone who reacted, any
// emoji" so achievements and anything else counting engagement keeps
// working unchanged; post.reactions carries the per-person emoji detail
// for the reaction bar.
async function toggleReaction(postId, emoji = "❤️") {
    const post = db.posts.find(p => p.id === postId);
    if (!post) return;
    if (!post.likes) post.likes = [];
    if (!post.reactions) post.reactions = [];

    const mine = post.reactions.find(r => r.userId === currentUserId);
    const removing = !!mine && mine.emoji === emoji;

    // Update the screen immediately — don't wait on a network round trip
    // first. If someone else reacts to the same post at nearly the same
    // moment, the live post_likes subscription (setupSocialRealtime)
    // reconciles it a moment later, so this stays correct without
    // feeling slow.
    const prevReactions = post.reactions;
    const prevLikes = post.likes;
    post.reactions = post.reactions.filter(r => r.userId !== currentUserId);
    if (!removing) post.reactions.push({ userId: currentUserId, emoji });
    post.likes = removing
        ? post.likes.filter(id => id !== currentUserId)
        : (post.likes.includes(currentUserId) ? post.likes : [...post.likes, currentUserId]);
    refreshPostInPlace(postId);
    if (!removing) haptic("tap");

    // Each person only ever upserts/deletes their OWN row here (post_id,
    // user_id primary key), which RLS can safely allow on any post —
    // unlike updating the whole post row, which only the post's author
    // is allowed to do. upsert covers both "first reaction" (insert) and
    // "changed emoji" (update) in one call.
    const { error } = removing
        ? await sb.from("post_likes").delete().eq("post_id", postId).eq("user_id", currentUserId)
        : await sb.from("post_likes").upsert(
            { post_id: postId, user_id: currentUserId, emoji },
            { onConflict: "post_id,user_id" }
        );

    if (error) {
        console.error(error);
        // roll back on failure
        post.reactions = prevReactions;
        post.likes = prevLikes;
        refreshPostInPlace(postId);
        toast("Не удалось поставить реакцию.");
        return;
    }

    if (!removing) createNotification({ userId: post.authorId, type: "post_like", postId });
}

// Kept as a thin alias — old callers (or any stale cached HTML from
// before this change) tapping a plain "like" still just react with ❤️.
function toggleLike(postId) { return toggleReaction(postId, "❤️"); }

function togglePostReactionPicker(event, postId) {
    event.stopPropagation();
    const article = document.querySelector(`[data-bubbles-post-id="${postId}"]`);
    const picker = article?.querySelector(".post-reaction-picker");
    if (!picker) return;
    const wasOpen = !picker.classList.contains("hidden");
    closeReactionPickers();
    if (!wasOpen) picker.classList.remove("hidden");
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
        return;
    }
    if (!wasLiked) createNotification({ userId: comment.authorId, type: "comment_like", postId, commentId });
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
    // Replies additionally notify whoever's top-level comment is being
    // replied to — otherwise only the POST's author ever finds out about
    // new activity in a thread, and someone two replies deep in a
    // conversation with a stranger on someone else's post would never
    // know they got a reply at all.
    if (parentId) {
        const parentComment = db.comments.find(c => c.id === parentId);
        if (parentComment && parentComment.authorId !== post?.authorId) {
            createNotification({ userId: parentComment.authorId, type: "comment_reply", postId, commentId: comment.id });
        }
    }
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
                <img loading="lazy" decoding="async" class="mini-avatar small" src="${author?.avatar || defaultAvatar()}">
                <strong>${escapeHtml(author?.displayName || "Пользователь")}</strong>
            </div>
            ${post.text ? `<div class="shared-post-card-text">${escapeHtml(post.text)}</div>` : ""}
            ${post.image ? `<img loading="lazy" decoding="async" class="shared-post-card-image" src="${post.image}">` : ""}
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
    const post = { id: uid("post"), authorId: currentUserId, wallOwnerId: currentUserId, text: caption, image: "", musicId: null, sharedPostId: postId, likes: [], reactions: [], createdAt: Date.now() };
    justAddedPostId = post.id;
        db.posts.unshift(post);
        setTimeout(() => { if (justAddedPostId === post.id) justAddedPostId = null; }, 600);
    const { error } = await sb.from("posts").insert({
        id: post.id, author_id: post.authorId, wall_owner_id: post.wallOwnerId, text: post.text, image: "", music_id: null, shared_post_id: postId, likes: [], created_at: new Date(post.createdAt).toISOString()
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
                            <img loading="lazy" decoding="async" class="mini-avatar small" src="${f.avatar || defaultAvatar()}">
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
                <img loading="lazy" decoding="async" class="mini-avatar small" src="${author.avatar || defaultAvatar()}">
                <strong>${escapeHtml(author.displayName)}</strong>
                <small>@${escapeHtml(author.username)} · ${timeAgo(original.createdAt)}</small>
            </div>
            ${original.text ? `<div class="shared-post-card-text">${escapeHtml(original.text)}</div>` : ""}
            ${original.image ? `<img loading="lazy" decoding="async" class="shared-post-card-image" src="${original.image}">` : ""}
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
                            <img loading="lazy" decoding="async" class="music-picker-cover" src="${m.cover || defaultMusicCover()}">
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
    }else if(context === "canvas"){
        closeBubblesModal();
        addCanvasItem({ type: "music", content: musicId });
    }else{
        selectedComposerMusicId = musicId;
        closeBubblesModal();
        if (context === "wall") renderWallComposerMusicChip();
        else renderComposerMusicChip();
    }
}

// Poll builder is plain DOM manipulation (not a re-render) so opening it
// never wipes out whatever text/image the person already staged in the
// composer above it — same reasoning as renderComposerMusicChip using
// direct DOM updates instead of calling renderFeed().
function togglePollComposer(){
    const box = document.getElementById("pollComposerBuilder");
    if (!box) return;
    box.classList.toggle("hidden");
    if (box.classList.contains("hidden")) resetPollComposerInputs();
}

// Resets the builder's inputs back to the two blank defaults — used both
// by "✕ Убрать опрос" (via togglePollComposer above) and after a
// successful post, so a submitted poll's text doesn't linger in a
// hidden builder for next time.
function resetPollComposerInputs(){
    const container = document.getElementById("pollOptionInputs");
    if (!container) return;
    container.innerHTML = `
        <input class="poll-option-input" maxlength="80" placeholder="Вариант 1">
        <input class="poll-option-input" maxlength="80" placeholder="Вариант 2">
    `;
}

function addPollOptionInput(){
    const container = document.getElementById("pollOptionInputs");
    if (!container) return;
    const current = container.querySelectorAll(".poll-option-input").length;
    if (current >= 5) { toast("Максимум 5 вариантов."); return; }
    const input = document.createElement("input");
    input.className = "poll-option-input";
    input.maxLength = 80;
    input.placeholder = `Вариант ${current + 1}`;
    container.appendChild(input);
}

// Reads whatever's currently typed into the poll builder, trimmed and
// with blanks dropped — this is the composer's single source of truth
// for poll options, same "read straight from the DOM at submit time" as
// postText/postImage above.
function readPollOptionsFromComposer(){
    const box = document.getElementById("pollComposerBuilder");
    if (!box || box.classList.contains("hidden")) return [];
    return [...document.querySelectorAll(".poll-option-input")]
        .map(input => input.value.trim())
        .filter(Boolean);
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
    editPostState = { postId, text: post.text || "", image: post.image || "", imagePreview: "", imageFile: null, musicId: post.musicId || null };
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
            (editPostState.imagePreview || editPostState.image)
            ? `
                <div class="message-image-preview">
                    <img src="${editPostState.imagePreview || editPostState.image}">
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
    // Only staged here, not uploaded yet — uploading immediately to the
    // post's (deterministic) storage path would overwrite the live image
    // right away, so cancelling the edit after picking a new photo would
    // still leave the old post showing the new one. The actual upload
    // happens in saveEditPost(), only once they confirm.
    try { editPostState.imagePreview = await resizeImageFile(file, 1600); }
    catch(e){ console.error(e); toast("Не удалось обработать изображение."); return; }
    editPostState.imageFile = file;
    renderEditPostModal();
}

function removeEditPostImage(){
    if(!editPostState) return;
    syncEditPostTextFromDom();
    editPostState.image = "";
    editPostState.imagePreview = "";
    editPostState.imageFile = null;
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
    const musicId = editPostState.musicId || null;
    if(!text && !editPostState.imageFile && !editPostState.image && !musicId){
        toast("Добавь текст, изображение или музыку.");
        return;
    }

    let image = editPostState.image || "";
    if (editPostState.imageFile) {
        try { image = await uploadImageToStorage(editPostState.imageFile, `${currentUserId}/post-${postId}.jpg`, 1600); }
        catch (e) { console.error(e); toast("Не удалось загрузить изображение."); return; }
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
    // They removed the photo entirely (no new file staged either) — the
    // old file at this post's deterministic Storage path is now orphaned.
    if (prev.image && !image && !editPostState.imageFile) {
        sb.storage.from(IMAGES_BUCKET).remove([`${currentUserId}/post-${postId}.jpg`]).catch(() => {});
    }
    closeBubblesModal();
    toast("Пост обновлён!");
}

async function deletePost(postId) {
    const post = db.posts.find(p => p.id === postId);
    const canDelete = post && (post.authorId === currentUserId || post.wallOwnerId === currentUserId || isAdmin());
    if (!canDelete) return;
    const deleteLabel = post.authorId === currentUserId ? "Удалить пост?" : (post.wallOwnerId === currentUserId ? "Удалить этот пост со своей стены?" : "Удалить этот пост как администратор?");
    if (!confirm(deleteLabel))
        return;
    const [postResult, commentResult] = await Promise.all([
        sb.from("posts").delete().eq("id", postId),
        sb.from("comments").delete().eq("post_id", postId)
    ]);
    if (postResult.error || commentResult.error) {
        toast("Не удалось удалить пост.");
        return;
    }
    // Best-effort cleanup of the image file in Storage — deterministic
    // path, so this is safe to call even for older posts whose image is
    // still inline base64 (nothing exists at that path, remove() just
    // no-ops rather than erroring the whole delete).
    if (post.image) {
        sb.storage.from(IMAGES_BUCKET).remove([`${post.authorId}/post-${post.id}.jpg`]).catch(() => {});
    }
    db.posts = db.posts.filter(p => p.id !== postId);
    db.comments = db.comments.filter(c => c.postId !== postId);
    // Cascades in the DB (poll -> options -> votes); mirror that locally too.
    const removedPoll = db.polls.find(p => p.postId === postId);
    if (removedPoll) {
        db.polls = db.polls.filter(p => p.postId !== postId);
        db.pollOptions = db.pollOptions.filter(o => o.pollId !== removedPoll.id);
    }
    mySavedPostIds.delete(postId);
    if (currentPage === "profile" && selectedProfileId) renderProfile(selectedProfileId);
    else renderFeed();
}

// Admin-only. Max 2 pinned posts at once — checked here for a fast,
// friendly error message, and enforced for real by a DB trigger (see
// protect_and_validate_post_pin in supabase.sql) so it can't be beaten
// by two admins pinning at the same moment.
async function togglePinPost(postId) {
    if (!isAdmin()) return;
    const post = db.posts.find(p => p.id === postId);
    if (!post) return;

    if (!post.pinned && db.posts.filter(p => p.pinned).length >= 2) {
        toast("Уже закреплено 2 поста — сначала открепи один из них.");
        return;
    }

    const pinned = !post.pinned;
    const { data, error } = await sb.from("posts")
        .update({ pinned })
        .eq("id", postId)
        .select("pinned,pinned_at")
        .single();
    if (error) {
        console.error(error);
        toast(error.message?.includes("максимум") ? error.message : "Не удалось изменить закрепление.");
        return;
    }
    post.pinned = !!data.pinned;
    post.pinnedAt = data.pinned_at ? Date.parse(data.pinned_at) : null;
    toast(post.pinned ? "Пост закреплён 📌" : "Пост откреплён.");
    renderFeed();
}

// Bookmarking, same optimistic-update-then-reconcile pattern as
// toggleMusicSave — purely personal (post_saves' RLS only ever lets you
// see/touch your own rows), so nothing here needs to notify the author
// or reconcile via realtime.
async function toggleSavePost(postId) {
    const wasSaved = mySavedPostIds.has(postId);
    if (wasSaved) mySavedPostIds.delete(postId); else mySavedPostIds.add(postId);
    refreshPostInPlace(postId);
    // On the "Сохранённое" page itself, unsaving should drop the post
    // from the list rather than leave it sitting there un-bookmarked.
    if (currentPage === "saved") renderSaved();

    const { error } = wasSaved
        ? await sb.from("post_saves").delete().eq("post_id", postId).eq("user_id", currentUserId)
        : await sb.from("post_saves").insert({ post_id: postId, user_id: currentUserId });

    if (error) {
        console.error(error);
        if (wasSaved) mySavedPostIds.add(postId); else mySavedPostIds.delete(postId);
        refreshPostInPlace(postId);
        if (currentPage === "saved") renderSaved();
        toast("Не удалось сохранить пост.");
    }
}

// Tapback-style voting, same semantics as toggleReaction: picking an
// option you haven't picked replaces any previous vote of yours on this
// poll, tapping your own current option again removes it.
async function voteInPoll(pollId, optionId) {
    const options = db.pollOptions.filter(o => o.pollId === pollId);
    if (!options.length) return;
    const poll = db.polls.find(p => p.id === pollId);
    if (!poll) return;

    const mine = options.find(o => o.votes.includes(currentUserId));
    const removing = !!mine && mine.id === optionId;

    // Update the screen immediately, reconcile from the server on
    // failure — same optimistic pattern as toggleReaction/toggleLike.
    const prevVotes = options.map(o => [...o.votes]);
    options.forEach(o => { o.votes = o.votes.filter(id => id !== currentUserId); });
    if (!removing) {
        const target = options.find(o => o.id === optionId);
        if (target) target.votes.push(currentUserId);
    }
    refreshPostInPlace(poll.postId);
    if (!removing) haptic("tap");

    const { error } = removing
        ? await sb.from("poll_votes").delete().eq("poll_id", pollId).eq("user_id", currentUserId)
        : await sb.from("poll_votes").upsert(
            { poll_id: pollId, option_id: optionId, user_id: currentUserId },
            { onConflict: "poll_id,user_id" }
        );

    if (error) {
        console.error(error);
        options.forEach((o, i) => { o.votes = prevVotes[i]; });
        refreshPostInPlace(poll.postId);
        toast("Не удалось проголосовать.");
    }
}

function renderSaved() {
    const page = document.getElementById("page");
    const posts = [...db.posts]
        .filter(p => mySavedPostIds.has(p.id))
        .sort((a, b) => b.createdAt - a.createdAt);

    page.innerHTML = `
        <h1 class="section-title">🔖 Сохранённое</h1>
        ${
            posts.length
            ? posts.map(renderPost).join("")
            : emptyState("🔖", "Здесь пока ничего нет", "Нажимай 🔖 под постом, чтобы сохранить его сюда.")
        }
    `;
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
        profileTab = "posts";
        lastProfileRenderId = userId;
    }
    const posts = db.posts.filter(p => p.authorId === user.id).sort((a,b) => b.createdAt - a.createdAt);
    const wallPosts = db.posts.filter(p => (p.wallOwnerId || p.authorId) === user.id).sort((a,b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.pinned && b.pinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
        return b.createdAt - a.createdAt;
    });
    const friends = db.friends.filter(f => f.user1 === user.id || f.user2 === user.id);
    // "Their music" = tracks they uploaded + tracks they saved to their
    // library from someone else — same rule as the "Моя музыка" tab.
    const savedIds = savesByUser.get(user.id) || new Set();
    const music = db.music.filter(m => m.authorId === user.id || savedIds.has(m.id));
    const isMe = user.id === currentUserId;
    const friend = isFriend(user.id);
    // Media tab — every wall post (own wall + posts left on it) that has
    // an image, newest first. Uses wallPosts (not the narrower `posts`)
    // so a photo someone else posted on this profile's wall still shows
    // up here, matching how the wall itself already works.
    const mediaPosts = wallPosts.filter(p => p.image);

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

                <img loading="lazy" decoding="async"
                    class="profile-avatar${avatarFrameClass(user)}"
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
                        ${subBadge(user)}

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

                                <button
                                    class="secondary"
                                    onclick="openCanvasRoom('${user.id}')"
                                >
                                    🎨 Моя комната
                                </button>

                                <button
                                    class="secondary"
                                    onclick="shareProfile('${user.id}')"
                                    title="Поделиться профилем"
                                >
                                    ↗ Поделиться
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

                                <button
                                    class="secondary${isFollowing(user.id) ? " following" : ""}"
                                    onclick="toggleFollow('${user.id}')"
                                >
                                    ${isFollowing(user.id) ? "✓ Подписан(а)" : "➕ Подписаться"}
                                </button>

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
                                    class="secondary profile-more-btn"
                                    onclick="openProfileMoreMenu('${user.id}')"
                                    title="Ещё"
                                >
                                    ⋯ Ещё
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
                        <strong>${wallPosts.length}</strong>
                        <span>постов на стене</span>
                    </div>

                    <div class="stat">
                        <strong>${friends.length}</strong>
                        <span>друзей</span>
                    </div>

                    <div class="stat" style="cursor:pointer" onclick="openFollowListModal('${user.id}','followers')">
                        <strong>${followersOf(user.id).length}</strong>
                        <span>подписчиков</span>
                    </div>

                    <div class="stat" style="cursor:pointer" onclick="openFollowListModal('${user.id}','following')">
                        <strong>${followingOf(user.id).length}</strong>
                        <span>подписок</span>
                    </div>

                    <div class="stat">
                        <strong>${music.length}</strong>
                        <span>треков</span>
                    </div>

                    <div class="stat">
                        <strong>${mediaPosts.length}</strong>
                        <span>медиа</span>
                    </div>

                </div>

            </div>

        </div>

        ${isMe && isAdmin() ? renderModerationQueue() + renderSubscriptionRequestsQueue() + renderAchievementsBackfillCard() : adminProfileControls(user)}

        ${renderAchievementsGrid(user)}

        <div class="profile-tabs">
            <button type="button" class="profile-tab${profileTab === 'posts' ? ' active' : ''}" onclick="setProfileTab('posts')">📝 Посты</button>
            <button type="button" class="profile-tab${profileTab === 'music' ? ' active' : ''}" onclick="setProfileTab('music')">🎵 Музыка</button>
            <button type="button" class="profile-tab${profileTab === 'friends' ? ' active' : ''}" onclick="setProfileTab('friends')">🫂 Друзья</button>
            <button type="button" class="profile-tab${profileTab === 'media' ? ' active' : ''}" onclick="setProfileTab('media')">🖼 Медиа</button>
        </div>

        ${profileTab === 'posts' ? `
        <section class="profile-wall">
            <p class="wall-subtitle">Видно только здесь, в профиле — в общую ленту не попадает.</p>

            ${
                isBlockedByMe(user.id)
                ? `<div class="card wall-locked">🚫 Стена недоступна</div>`
                : `
                    <div class="card wall-composer">
                        <div class="wall-composer-head">
                            <img loading="lazy" decoding="async" class="mini-avatar" src="${getCurrentUser()?.avatar || defaultAvatar()}">
                            <div>
                                <strong>${isMe ? "Что нового?" : `Написать на стене ${escapeHtml(user.displayName)}`}</strong>
                                <small>Пост появится прямо в профиле</small>
                            </div>
                        </div>
                        <textarea id="wallPostText" maxlength="1000" placeholder="${isMe ? "Что нового?" : `Напиши что-нибудь для ${escapeHtml(user.displayName)}…`}"></textarea>
                        <input id="wallPostImage" type="file" accept="image/*" style="max-width:100%;">
                        <div class="wall-composer-actions">
                            <button type="button" class="secondary" onclick="openMusicPicker('wall')">🎵 Музыка</button>
                            <button id="wallCreatePostBtn" type="button" class="primary" onclick="createWallPost('${user.id}')">Опубликовать</button>
                        </div>
                        <div id="wallComposerMusicChip"></div>
                    </div>
                `
            }

            <div id="profileWallPosts">
                ${wallPosts.length ? wallPosts.map(renderPost).join("") : emptyState("🫧", "Стена пустая", isMe ? "Напиши первый пост." : "Оставь первый пост на стене этого пользователя.")}
            </div>
        </section>
        ` : ''}

        ${profileTab === 'music' ? `
        ${
            music.length
            ? `
                ${
                    (profileMusicExpanded ? music : music.slice(0, 12))
                        .map(musicProfileCard)
                        .join("")
                }
                ${
                    music.length > 12
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
        ` : ''}

        ${profileTab === 'friends' ? `
        ${
            friends.length
            ? `
                <div class="friend-grid">

                    ${
                        friends
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
            `
            : emptyState(
                "🫂",
                "Друзей пока нет",
                "Здесь появятся друзья пользователя."
            )
        }
        ` : ''}

        ${profileTab === 'media' ? `
        ${
            mediaPosts.length
            ? `
                <div class="profile-media-grid">
                    ${
                        mediaPosts.map(p => `
                            <button
                                type="button"
                                class="profile-media-thumb"
                                onclick="goToProfileMedia('${p.id}','${user.id}')"
                            >
                                <img loading="lazy" decoding="async" src="${p.image}">
                            </button>
                        `).join("")
                    }
                </div>
            `
            : emptyState(
                "🖼",
                "Здесь пока ничего нет 🫧",
                isMe ? "Посты с фото появятся тут." : "Пользователь ещё не публиковал фото."
            )
        }
        ` : ''}



    `;
}

function musicProfileCard(music){
    const author = getUser(music.authorId);

    return `

        <div class="music-card">

            <div class="music-row">

                <img loading="lazy" decoding="async"
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

async function renderEditProfile(){
    const user = getCurrentUser();
    pendingAvatarBlob = null;
    pendingAvatarExt = "jpg";
    pendingCoverBlob = null;
    const callSettingsSection = await renderCallSettingsPageSection();
    const telegramSettingsSection = await renderTelegramSettingsSection();

    document.getElementById("page").innerHTML = `

        <h1 class="section-title">
            ⚙️ Настройки профиля
        </h1>


        <div class="card" style="margin-bottom:16px;">
            <strong>🔔 Уведомления Bubbles</strong>
            <div id="pushStatus" style="color:#7b9ca9;font-size:13px;margin:8px 0 12px;line-height:1.45;">
                Проверяем возможность уведомлений…
            </div>
            <button id="enablePushButton" class="primary" type="button" onclick="enablePushNotifications()">
                🔔 Включить уведомления
            </button>
        </div>


        <div class="card" style="margin-bottom:16px;">
            <strong>🔊 Звуки</strong>
            <label class="autoplay-toggle" style="margin-top:10px;">
                <input type="checkbox" ${soundSettings.enabled ? "checked" : ""} onchange="setSoundsEnabled(this.checked); document.getElementById('soundVolumeRow').style.cssText = this.checked ? '' : 'opacity:.5;pointer-events:none;'; if(this.checked) playSound('notification');">
                Звуки сообщений, звонков и уведомлений
            </label>
            <div style="margin-top:12px;${soundSettings.enabled ? "" : "opacity:.5;pointer-events:none;"}" id="soundVolumeRow">
                <label style="font-size:13px;color:#7b9ca9;display:block;margin-bottom:6px;">Громкость</label>
                <input type="range" min="0" max="1" step="0.05" value="${soundSettings.volume}"
                    oninput="setSoundVolume(parseFloat(this.value))"
                    onchange="playSound('notification')"
                    style="width:100%;">
            </div>
        </div>


        ${callSettingsSection}


        ${telegramSettingsSection}


        <div class="card" style="margin-bottom:16px;">
            <strong>🔒 Приватность</strong>

            <label class="autoplay-toggle" style="margin-top:10px;">
                <input type="checkbox" ${user.showOnlineStatus ? "checked" : ""} onchange="setPrivacySetting('show_online_status', this.checked)">
                Показывать статус "онлайн" другим людям
            </label>

            <div class="form-group" style="margin-top:14px;">
                <label>Кто видит мою стену</label>
                <select id="privacyWallVisibility" onchange="setPrivacySetting('wall_visibility', this.value)">
                    <option value="everyone" ${user.wallVisibility === "everyone" ? "selected" : ""}>Все</option>
                    <option value="friends" ${user.wallVisibility === "friends" ? "selected" : ""}>Только друзья</option>
                </select>
            </div>

            <div class="form-group">
                <label>Кто видит мою музыку</label>
                <select id="privacyMusicVisibility" onchange="setPrivacySetting('music_visibility', this.value)">
                    <option value="everyone" ${user.musicVisibility === "everyone" ? "selected" : ""}>Все</option>
                    <option value="friends" ${user.musicVisibility === "friends" ? "selected" : ""}>Только друзья</option>
                </select>
            </div>

            <div class="form-group">
                <label>Кто может писать мне сообщения</label>
                <select id="privacyWhoCanMessage" onchange="setPrivacySetting('who_can_message', this.value)">
                    <option value="everyone" ${user.whoCanMessage === "everyone" ? "selected" : ""}>Все</option>
                    <option value="friends" ${user.whoCanMessage === "friends" ? "selected" : ""}>Только друзья</option>
                    <option value="nobody" ${user.whoCanMessage === "nobody" ? "selected" : ""}>Никто</option>
                </select>
            </div>

            <div class="form-group" style="margin-bottom:0;">
                <label>Кто может отправлять мне заявки в друзья</label>
                <select id="privacyWhoCanFriendRequest" onchange="setPrivacySetting('who_can_friend_request', this.value)">
                    <option value="everyone" ${user.whoCanFriendRequest === "everyone" ? "selected" : ""}>Все</option>
                    <option value="nobody" ${user.whoCanFriendRequest === "nobody" ? "selected" : ""}>Никто</option>
                </select>
            </div>

            <div class="muted" style="font-size:12px;margin-top:10px;line-height:1.4;">
                Посты и лайки/комментарии от друзей на твою стену видят те же люди, кому видна сама стена.
            </div>
        </div>


        <div class="card">

            <div class="edit-preview">

                <img loading="lazy" decoding="async"
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
                        PNG, JPG, WEBP или GIF (с анимацией)
                    </div>

                </div>

            </div>


            <div class="form-group">

                <label>Аватар</label>

                <input
                    id="editAvatar"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onchange="onAvatarFileChosen(this)"
                >

                <div class="muted" style="font-size:12px;margin-top:6px;">GIF загрузится как есть, с анимацией — без выбора области.</div>

            </div>


            <div class="form-group">

                <label>Обложка профиля</label>

                <input
                    id="editCover"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onchange="onCoverFileChosen(this)"
                >

                <img loading="lazy" decoding="async" id="editCoverPreview"
                    src="${user.cover || ""}"
                    style="width:100%;border-radius:14px;margin-top:10px;object-fit:cover;aspect-ratio:3;${user.cover ? "" : "display:none;"}">

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

        <div class="card" style="margin-top:16px;">
            <strong>Аккаунт</strong>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                <button
                    class="secondary"
                    onclick="location.href='https://alayseerasen.github.io/aeroworld/bubbling.html'"
                >
                    🫧 Aero World
                </button>
                <button
                    class="secondary"
                    onclick="logout()"
                >
                    🚪 Выйти
                </button>
            </div>
        </div>

        <div class="card" style="margin-top:16px;border:1px solid #e5544f55;">
            <strong style="color:#e5544f;">⚠️ Удаление аккаунта</strong>
            <div class="muted" style="font-size:12px;margin:8px 0 12px;line-height:1.4;">
                Удаляет профиль, посты, комментарии, друзей, музыку и файлы без возврата.
                Сообщения между тобой и другими людьми также удаляются с обеих сторон.
            </div>
            <button class="secondary" style="color:#e5544f;" onclick="confirmDeleteAccount()">
                🗑️ Удалить аккаунт навсегда
            </button>
        </div>

    `;
    updatePushSettingsUI(false);
    // If permission was already granted, restore/register the subscription
    // without opening a permission prompt.
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        subscribeToPush({ requestPermission: false });
    }
}

const MAX_AVATAR_GIF_SIZE = 8 * 1024 * 1024;

async function onAvatarFileChosen(input){
    const file = input.files[0];
    if(!file) return;
    if(!file.type.startsWith("image/")){
        toast("Выбери изображение.");
        input.value = "";
        return;
    }

    const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
    if (isGif) {
        // Кроппер рисует через canvas, а это всегда один статичный кадр —
        // для GIF так анимация просто потеряется. Загружаем как есть.
        if (file.size > MAX_AVATAR_GIF_SIZE) {
            toast("GIF слишком большой. Максимум 8 МБ.");
            input.value = "";
            return;
        }
        input.value = "";
        pendingAvatarBlob = file;
        pendingAvatarExt = "gif";
        document.getElementById("editAvatarPreview").src = URL.createObjectURL(file);
        return;
    }

    const blob = await openImageCropper(file, { aspect: 1, outputSize: 800 });
    input.value = ""; // файл уже "внутри" blob'а, сам инпут больше не нужен
    if (!blob) return; // отменили кроп
    pendingAvatarBlob = blob;
    pendingAvatarExt = "jpg";
    document.getElementById("editAvatarPreview").src = URL.createObjectURL(blob);
}

async function onCoverFileChosen(input){
    const file = input.files[0];
    if(!file) return;
    if(!file.type.startsWith("image/")){
        toast("Выбери изображение.");
        input.value = "";
        return;
    }
    const blob = await openImageCropper(file, { aspect: 3, outputSize: 1500 });
    input.value = "";
    if (!blob) return;
    pendingCoverBlob = blob;
    const preview = document.getElementById("editCoverPreview");
    preview.src = URL.createObjectURL(blob);
    preview.style.display = "";
}

// Each privacy toggle saves itself immediately on change (same pattern
// as the sound settings above) — no separate "save" button, so a
// setting can never be left un-persisted if someone navigates away.
const PRIVACY_SETTING_KEYS = {
    show_online_status: "showOnlineStatus",
    wall_visibility: "wallVisibility",
    music_visibility: "musicVisibility",
    who_can_message: "whoCanMessage",
    who_can_friend_request: "whoCanFriendRequest"
};
async function setPrivacySetting(column, value) {
    const user = getCurrentUser();
    if (!user) return;
    const { error } = await sb.from("profiles").update({ [column]: value }).eq("id", user.id);
    if (error) {
        console.error(error);
        toast("Не удалось сохранить настройку приватности.");
        return;
    }
    const localKey = PRIVACY_SETTING_KEYS[column];
    if (localKey) user[localKey] = value;
    toast("Сохранено ✅");
}

// Deletes the account for real (via the delete-account Edge Function —
// see supabase/functions/delete-account/README.md for the one-time
// deploy step this depends on). Double confirmation because this is
// irreversible: the first confirm() is a normal "are you sure", the
// second requires typing the exact word "удалить" so a stray tap on
// the button can never actually delete anything by accident.
async function confirmDeleteAccount() {
    if (!confirm("Аккаунт и все данные будут удалены без возврата. Продолжить?")) return;
    const typed = prompt('Чтобы подтвердить, напиши слово "удалить" (без кавычек):');
    if ((typed || "").trim().toLowerCase() !== "удалить") {
        toast("Отменено — слово не совпало.");
        return;
    }
    try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) { toast("Сессия не найдена, попробуй войти снова."); return; }
        const res = await fetch(`${window.BUBBLES_SUPABASE_URL}/functions/v1/delete-account`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` }
        });
        if (!res.ok) throw new Error(await res.text());
        toast("Аккаунт удалён.");
        await sb.auth.signOut();
        location.reload();
    } catch (e) {
        console.error(e);
        toast("Не удалось удалить аккаунт. Попробуй позже.");
    }
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
    if (pendingAvatarBlob) {
        const contentType = pendingAvatarExt === "gif" ? "image/gif" : "image/jpeg";
        // Аватар мог раньше быть другого формата (jpg <-> gif) — путь в
        // Storage теперь меняется вместе с расширением, так что старый
        // файл сам не перезапишется. Подчищаем его, чтобы не копился мусор.
        const oldExt = pendingAvatarExt === "gif" ? "jpg" : "gif";
        sb.storage.from(IMAGES_BUCKET).remove([`${user.id}/avatar.${oldExt}`]).catch(() => {});
        try { user.avatar = await uploadBlobToStorage(pendingAvatarBlob, `${user.id}/avatar.${pendingAvatarExt}`, contentType); }
        catch (e) { console.error(e); toast("Не удалось загрузить аватар."); return; }
    }
    if (pendingCoverBlob) {
        try { user.cover = await uploadBlobToStorage(pendingCoverBlob, `${user.id}/cover.jpg`); }
        catch (e) { console.error(e); toast("Не удалось загрузить обложку."); return; }
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
    pendingAvatarBlob = null;
    pendingAvatarExt = "jpg";
    pendingCoverBlob = null;
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
                            <img loading="lazy" decoding="async" class="${avatarFrameClass(user).trim()}" src="${user.avatar || defaultAvatar()}" onclick="navigate('profile','${user.id}')" style="cursor:pointer">
                            <h4>${escapeHtml(user.displayName)} ${subBadge(user, { fontSize: "9px" })}</h4>
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
                            <img loading="lazy" decoding="async" class="${avatarFrameClass(user).trim()}" src="${user.avatar || defaultAvatar()}" onclick="navigate('profile','${user.id}')" style="cursor:pointer">
                            <h4>${escapeHtml(user.displayName)} ${subBadge(user, { fontSize: "9px" })}</h4>
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

            <img loading="lazy" decoding="async"
                class="${avatarFrameClass(user).trim()}"
                src="${user.avatar || defaultAvatar()}"
                onclick="navigate('profile','${user.id}')"
                style="cursor:pointer"
            >

            <h4>
                ${escapeHtml(user.displayName)} ${subBadge(user, { fontSize: "9px" })}
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

function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isBubblesInstalled() {
    return window.matchMedia?.("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;
}

async function subscribeToPush({ requestPermission = false } = {}) {
    if (!currentUserId) return false;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    if (!window.BUBBLES_VAPID_PUBLIC_KEY) return false;
    if (typeof Notification === "undefined") return false;

    // Service workers can't run at all over file:// (opening index.html
    // straight from disk) — the browser refuses to register one, so
    // there's nothing to subscribe with. This used to fail completely
    // silently (the button just looked broken); now it says why.
    if (location.protocol === "file:") {
        if (requestPermission) toast("Уведомления не работают при открытии файла напрямую — размести сайт на сервере (например, GitHub Pages).", 7000);
        return false;
    }

    // iOS only exposes Web Push to Home Screen web apps, not ordinary Safari tabs.
    if (isIOSDevice() && !isBubblesInstalled()) return false;
    if (Notification.permission === "denied") return false;
    if (!requestPermission && Notification.permission !== "granted") return false;

    // Each step below is wrapped separately and throws a short, specific
    // tag (permission / registration-timeout / subscribe / save) instead
    // of letting everything collapse into one opaque "something broke".
    // The outer catch turns that tag into copy the person can actually
    // act on.
    let step = "permission";
    try {
        // Ask for permission FIRST, before touching anything async like
        // the service worker or an existing subscription. This matters a
        // lot on iOS/Safari: WebKit only honours Notification.requestPermission()
        // as a direct response to the tap that triggered it, and silently
        // drops the request (no prompt, no error, permission just stays
        // "default" forever) the moment there's an await — even a fast
        // one — sitting in front of it. Asking immediately, as the very
        // first thing this function does off the click, is what keeps the
        // native prompt actually showing up on iPhone.
        if (Notification.permission !== "granted") {
            const permission = await Notification.requestPermission();
            if (permission !== "granted") return false;
        }

        step = "registration";
        const registration = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))
        ]).catch(err => { throw Object.assign(new Error("registration-timeout"), { cause: err }); });

        step = "getSubscription";
        let subscription = await registration.pushManager.getSubscription();

        // If Bubbles rotated its VAPID key, the old browser subscription is
        // no longer valid for the new key. Forget it and create a fresh one.
        const vapidKey = window.BUBBLES_VAPID_PUBLIC_KEY;
        const knownVapidKey = localStorage.getItem("bubbles-vapid-public-key");
        if (subscription && knownVapidKey && knownVapidKey !== vapidKey) {
            try { await subscription.unsubscribe(); } catch (_) {}
            subscription = null;
        }

        if (!subscription) {
            step = "subscribe";
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey)
            });
        }
        localStorage.setItem("bubbles-vapid-public-key", vapidKey);

        step = "save";
        const json = subscription.toJSON();
        const { error } = await sb.from("push_subscriptions").upsert({
            id: uid("push"),
            user_id: currentUserId,
            endpoint: json.endpoint,
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth
        }, { onConflict: "endpoint" });

        if (error) throw Object.assign(new Error("save"), { cause: error });

        updatePushSettingsUI(true);
        toast("🔔 Уведомления Bubbles включены!");
        return true;
    } catch (error) {
        console.error(`Push subscribe failed at step "${step}":`, error, error?.cause || "");
        if (requestPermission) {
            const messages = {
                "registration-timeout": "Service worker не подключился вовремя. Полностью закрой Bubbles (смахни из списка приложений на iPhone) и открой заново — не просто обнови страницу.",
                getSubscription: "Не удалось прочитать текущую push-подписку браузера.",
                subscribe: "Браузер отказался создать push-подписку — обычно это старая/повреждённая подписка. Попробуй удалить Bubbles с экрана Домой и добавить заново.",
                save: "Подписка создана, но не сохранилась на сервере — проверь, что таблица push_subscriptions существует (supabase.sql) и RLS её не блокирует.",
                permission: "iPhone не показал запрос на разрешение. Открой приложение заново (закрыть и открыть, не просто обновить страницу) и сразу нажми «Включить уведомления»."
            };
            toast(messages[step] || "Не удалось включить уведомления. Попробуй ещё раз через пару секунд.", 8000);
        }
        return false;
    }
}


async function enablePushNotifications() {
    if (isIOSDevice() && !isBubblesInstalled()) {
        toast("Сначала добавь Bubbles на экран Домой через Safari → Поделиться → На экран Домой.", 7000);
        return;
    }
    const ok = await subscribeToPush({ requestPermission: true });
    if (ok) return;
    // Every other failure path now shows its own specific message from
    // inside subscribeToPush() itself (see the `step` tagging there) —
    // this only covers "denied", which subscribeToPush intentionally
    // returns early on without a toast, since the wording differs
    // between platforms.
    if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        toast("Уведомления запрещены. Включи их в настройках уведомлений Bubbles на iPhone.", 7000);
    }
}

function updatePushSettingsUI(enabled = false) {
    const status = document.getElementById("pushStatus");
    const button = document.getElementById("enablePushButton");
    if (!status || !button) return;
    if (enabled) {
        status.textContent = "Уведомления включены — сообщения, лайки и заявки будут приходить на устройство.";
        button.textContent = "🔔 Уведомления включены";
        button.disabled = true;
        return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        status.textContent = "Уведомления запрещены в настройках устройства.";
        button.textContent = "⚙️ Как включить уведомления";
        button.disabled = false;
        return;
    }
    status.textContent = isIOSDevice() && !isBubblesInstalled()
        ? "На iPhone сначала добавь Bubbles на экран Домой, затем включи уведомления здесь."
        : "Получай сообщения, лайки и заявки, даже когда Bubbles закрыт.";
    button.textContent = "🔔 Включить уведомления";
    button.disabled = false;
}

function unreadNotificationsCount() {
    return db.notifications.filter(n => !n.readAt).length;
}

// See the systemNotifications declaration above for why these are
// session-only rather than a DB table — capped at 30 so a very long
// session doesn't grow this unbounded.
function pushSystemNotification(text, icon) {
    systemNotifications.unshift({ id: uid("sysnotif"), text, icon: icon || "🔔", createdAt: Date.now(), read: false });
    systemNotifications = systemNotifications.slice(0, 30);
    updateNavBadges();
}

// Which of the notification center's 4 tabs a given DB notification
// type belongs to — every type currently created (see createNotification
// call sites) is a social/friend-graph event, so this only really
// exists so a future type has somewhere obvious to be routed.
function notificationCategory(type) {
    return "social";
}

// "Сообщения" tab content — not its own stored notification type at
// all, just a read of the chat system's own existing unread state
// (messages already track read_at, see markChatAsRead), grouped by
// sender so it reads as "N unread from X" rather than one row per
// message.
// Same three-way Russian pluralization as pluralPeople/pluralVotes
// above, for "сообщение/сообщения/сообщений" (unread message counts).
function pluralMessages(n){
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "новое сообщение";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "новых сообщения";
    return "новых сообщений";
}

function unreadMessageSenders() {
    if (!currentUserId || !Array.isArray(db.messages)) return [];
    const bySender = new Map();
    db.messages.forEach(m => {
        if (m.to !== currentUserId || m.readAt) return;
        if (!bySender.has(m.from)) bySender.set(m.from, { userId: m.from, count: 0, lastAt: 0 });
        const entry = bySender.get(m.from);
        entry.count++;
        entry.lastAt = Math.max(entry.lastAt, m.createdAt);
    });
    return [...bySender.values()].sort((a, b) => b.lastAt - a.lastAt);
}

async function markNotificationRead(id) {
    const n = db.notifications.find(x => x.id === id);
    if (!n || n.readAt) return;
    n.readAt = Date.now();
    updateNavBadges();
    const { error } = await sb.from("bubbles_notifications")
        .update({ read_at: new Date(n.readAt).toISOString() })
        .eq("id", id)
        .eq("user_id", currentUserId);
    if (error) console.error("❌ Не удалось отметить уведомление прочитанным:", error);
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
        case "comment_reply":
            return { text: `${name} ответил(а) на ваш комментарий 💬`, onclick: `goToPost('${n.postId}')` };
        case "comment_like":
            return { text: `${name} оценил(а) ваш комментарий ❤️`, onclick: `goToPost('${n.postId}')` };
        case "wall_post":
            return { text: `${name} оставил(а) запись на вашей стене 🧱`, onclick: `goToPost('${n.postId}')` };
        case "pet_fed":
            return { text: `${name} покормил(а) вашего питомца 🍬`, onclick: `navigate('pet')` };
        case "new_follower":
            return { text: `${name} подписался(ась) на вас 🔔`, onclick: `navigate('profile','${n.actorId}')` };
        case "story_reaction":
            return { text: `${name} отреагировал(а) на вашу историю`, onclick: `openStoryViewer('${n.actorId}')` };
        default:
            return { text: name, onclick: "" };
    }
}

const NOTIF_TABS = [
    { id: "all", label: "Все" },
    { id: "social", label: "Социальные" },
    { id: "messages", label: "Сообщения" },
    { id: "system", label: "Система" }
];

function renderNotificationsPanel() {
    const socialItems = [...db.notifications].sort((a, b) => b.createdAt - a.createdAt);
    const messageSenders = unreadMessageSenders();
    const sysItems = systemNotifications;

    const showSocial = notifFilterTab === "all" || notifFilterTab === "social";
    const showMessages = notifFilterTab === "all" || notifFilterTab === "messages";
    const showSystem = notifFilterTab === "all" || notifFilterTab === "system";

    const totalUnread = unreadNotificationsCount() + messageSenders.length + sysItems.filter(s => !s.read).length;

    const socialHtml = !showSocial ? "" : socialItems.filter(n => notificationCategory(n.type) === "social").map(n => {
        const { text, onclick } = notificationLine(n);
        const actor = getUser(n.actorId);
        return `
            <div class="notif-item${n.readAt ? "" : " unread"}" onclick="markNotificationRead('${n.id}');${onclick};closeNotificationsPanel();">
                <img loading="lazy" decoding="async" class="mini-avatar" src="${actor?.avatar || defaultAvatar()}">
                <div class="notif-item-body">
                    <span>${text}</span>
                    <small>${new Date(n.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
                </div>
                ${n.readAt ? "" : `<button type="button" class="notif-mark-read-btn" onclick="event.stopPropagation();markNotificationRead('${n.id}');this.closest('.notif-item').classList.remove('unread');this.remove();" title="Отметить прочитанным">✓</button>`}
            </div>
        `;
    }).join("");

    const messagesHtml = !showMessages ? "" : messageSenders.map(entry => {
        const user = getUser(entry.userId);
        return `
            <div class="notif-item unread" onclick="openChat('${entry.userId}');closeNotificationsPanel();">
                <img loading="lazy" decoding="async" class="mini-avatar" src="${user?.avatar || defaultAvatar()}">
                <div class="notif-item-body">
                    <span>${escapeHtml(user?.displayName || "Пользователь")}: ${entry.count} ${pluralMessages(entry.count)} 💬</span>
                    <small>${new Date(entry.lastAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
                </div>
            </div>
        `;
    }).join("");

    const systemHtml = !showSystem ? "" : sysItems.map(s => `
        <div class="notif-item${s.read ? "" : " unread"}">
            <span class="notif-item-icon">${s.icon}</span>
            <div class="notif-item-body">
                <span>${escapeHtml(s.text)}</span>
                <small>${new Date(s.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
            </div>
        </div>
    `).join("");

    const combinedHtml = socialHtml + messagesHtml + systemHtml;

    return `
        <div class="notif-panel-header">
            <span>Уведомления</span>
            ${totalUnread ? `<button type="button" class="notif-mark-all-btn" onclick="markAllNotificationsRead()">✓✓ Прочитать всё</button>` : ""}
        </div>
        <div class="notif-panel-tabs">
            ${
                NOTIF_TABS.map(t => `
                    <button type="button" class="notif-panel-tab${notifFilterTab === t.id ? " active" : ""}" onclick="setNotifFilterTab('${t.id}')">
                        ${t.label}
                    </button>
                `).join("")
            }
        </div>
        <div class="notif-panel-list notif-fade-in">
            ${combinedHtml || `<div class="empty notif-empty">Пока ничего нет.</div>`}
        </div>
    `;
}

function setNotifFilterTab(tab) {
    notifFilterTab = tab;
    const panel = document.getElementById("notifPanel");
    if (panel) panel.innerHTML = renderNotificationsPanel();
}

// Marks every social notification AND every session-local system one
// read; messages aren't included here — they're only ever marked read
// by actually opening that chat (markChatAsRead), same as everywhere
// else in the app, so there's no separate bulk action for them.
async function markAllNotificationsRead() {
    systemNotifications.forEach(s => { s.read = true; });
    const unread = db.notifications.filter(n => !n.readAt);
    if (unread.length) {
        const readAt = new Date().toISOString();
        unread.forEach(n => { n.readAt = Date.parse(readAt); });
        const { error } = await sb
            .from("bubbles_notifications")
            .update({ read_at: readAt })
            .in("id", unread.map(n => n.id))
            .eq("user_id", currentUserId);
        if (error) console.error("❌ Не удалось отметить уведомления прочитанными:", error);
    }
    updateNavBadges();
    const panel = document.getElementById("notifPanel");
    if (panel && !panel.classList.contains("hidden")) panel.innerHTML = renderNotificationsPanel();
}

// Opens/closes the bell dropdown. Unlike before, opening no longer
// silently marks everything read — with per-item ✓ buttons and an
// explicit "Прочитать всё" now available, seeing the list shouldn't be
// the same action as dismissing it.
function toggleNotificationsPanel(event) {
    event.stopPropagation();
    const panel = document.getElementById("notifPanel");
    if (!panel) return;
    const wasOpen = !panel.classList.contains("hidden");
    if (wasOpen) {
        closeNotificationsPanel();
        return;
    }
    notifFilterTab = "all";
    panel.innerHTML = renderNotificationsPanel();
    panel.classList.remove("hidden");
    positionNotificationsPanel(panel);
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

// Every textarea in the app is a content-composition field (post, bio,
// caption, edit) — growing with what you type instead of forcing you
// to scroll inside a cramped box is just more comfortable to type
// into, especially on a phone keyboard. Delegated on document so it
// covers textareas that don't exist yet at page load (modals, edit
// forms rendered later) without wiring up each one individually.
function autoGrowTextarea(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 420) + "px";
}
document.addEventListener("input", (e) => {
    if (e.target.tagName === "TEXTAREA") autoGrowTextarea(e.target);
});
// Textareas that already have content when they're rendered (editing an
// existing post/bio) need one initial resize too, not just on typing.
document.addEventListener("focusin", (e) => {
    if (e.target.tagName === "TEXTAREA") autoGrowTextarea(e.target);
    // Hides the fixed bottom nav while the on-screen keyboard is open.
    // Fixed-position elements interact inconsistently with the iOS
    // keyboard across Safari versions (sometimes floating awkwardly
    // above it, sometimes hidden behind it) — rather than chase that
    // per-version behavior, just get it out of the way entirely
    // whenever something is actually being typed into. Also frees up
    // real vertical space for the content while typing, which helps
    // regardless of platform.
    if (e.target.matches("input,textarea")) document.body.classList.add("keyboard-open");
});
document.addEventListener("focusout", (e) => {
    if (e.target.matches("input,textarea")) document.body.classList.remove("keyboard-open");
});

window.addEventListener("resize", () => {
    const panel = document.getElementById("notifPanel");
    if (panel && !panel.classList.contains("hidden")) positionNotificationsPanel(panel);
});

// Jumps to the feed and scrolls/highlights one post — used by post_like
// and post_comment notifications. The post might have scrolled off, been
// deleted, or belong to someone whose posts aren't shown here, so this
// fails quietly if the element never shows up.
function goToPost(postId) {
    const post = db.posts.find(p => p.id === postId);
    // Wall posts don't appear in the main feed (see renderFeed's filter) —
    // used to send you there anyway, which meant every like/comment/reply
    // notification on a wall post led to a dead end with nothing to
    // scroll to. Route those to the wall itself instead.
    if (post && post.wallOwnerId && post.wallOwnerId !== post.authorId) {
        navigate("profile", post.wallOwnerId);
    } else {
        navigate("feed");
    }
    setTimeout(() => {
        const el = document.querySelector(`[data-bubbles-post-id="${postId}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("post-highlight");
        setTimeout(() => el.classList.remove("post-highlight"), 1600);
    }, 50);
}

function setProfileTab(tab) {
    profileTab = tab;
    renderProfile(selectedProfileId || currentUserId);
    replayPageTransition();
}

// Media tab thumbnails link back into the Посты tab of the same profile,
// scrolled to that post — same scroll-and-highlight as goToPost above,
// just always routed through the profile (media only ever exists on a
// wall, never the main feed).
function goToProfileMedia(postId, userId) {
    profileTab = "posts";
    navigate("profile", userId);
    setTimeout(() => {
        const el = document.querySelector(`[data-bubbles-post-id="${postId}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("post-highlight");
        setTimeout(() => el.classList.remove("post-highlight"), 1600);
    }, 50);
}

// Shares a deep link to a profile — #u-<username> is read once at boot
// (see the hash check near startApp) and opens straight to that profile.
// navigator.share gives the native share sheet on iOS/Android where
// available; clipboard is the fallback everywhere else.
function shareProfile(userId) {
    const user = getUser(userId);
    if (!user) return;
    const url = `${location.origin}${location.pathname}#u-${encodeURIComponent(user.username)}`;
    if (navigator.share) {
        navigator.share({ title: user.displayName, url }).catch(() => {});
        return;
    }
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url)
            .then(() => toast("Ссылка на профиль скопирована 🔗"))
            .catch(() => toast(url, 8000));
        return;
    }
    toast(url, 8000);
}

/* ============================================================
   MESSAGES
   ============================================================ */

// The profile header used to show up to 8 buttons side by side
// (relationship action, follow, chat, room, pet, share, report, block).
// This collapses the less-frequent ones behind a single "⋯ Ещё" button
// into an action-sheet, reusing the same generic modal the share
// picker uses. closeBubblesModal() runs first in every handler so the
// sheet is gone before the follow-up action (navigation, confirm()
// dialog, etc.) takes over.
function openProfileMoreMenu(userId) {
    const user = getUser(userId);
    if (!user) return;
    showBubblesModal(`
        <div class="modal-header">
            <h3>Ещё</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        <div class="profile-menu-list">
            <button class="profile-menu-item" onclick="closeBubblesModal();openCanvasRoom('${userId}')">
                <span class="profile-menu-icon">🎨</span> Комната
            </button>
            <button class="profile-menu-item" onclick="closeBubblesModal();visitFriendsPet('${userId}')">
                <span class="profile-menu-icon">🐣</span> Питомец
            </button>
            <button class="profile-menu-item" onclick="closeBubblesModal();shareProfile('${userId}')">
                <span class="profile-menu-icon">↗</span> Поделиться профилем
            </button>
            <button class="profile-menu-item" onclick="closeBubblesModal();reportProfile('${userId}')">
                <span class="profile-menu-icon">🚩</span> Пожаловаться
            </button>
            <button class="profile-menu-item profile-menu-item-danger" onclick="closeBubblesModal();toggleBlockUser('${userId}')">
                <span class="profile-menu-icon">🚫</span> Заблокировать
            </button>
        </div>
    `);
}

function openChat(userId) {
    if (selectedChatId !== userId) chatVisibleCount = CHAT_PAGE_SIZE; // switching conversations — start back at "just the recent tail", same reasoning as feedVisibleCount
    selectedChatId = userId;
    selectedMessageImage = null; // a staged photo shouldn't follow you into a different chat
    replyingToMessageId = null; // neither should a pending reply
    editingMessageId = null; // or an in-progress edit
    chatSearchOpen = false;
    chatSearchQuery = "";
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
        renderReplyPreviewBar();
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

            <img loading="lazy" decoding="async"
                class="mini-avatar${avatarFrameClass(user)}"
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

let chatVisibleCount = 40;
const CHAT_PAGE_SIZE = 40;

// "Сегодня" / "Вчера" / full date — same idea as most chat apps' date
// separators, inserted between messages from different days (see the
// sameDay check in renderChat).
function chatDateDivider(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    let label;
    if (date.toDateString() === today.toDateString()) label = "Сегодня";
    else if (date.toDateString() === yesterday.toDateString()) label = "Вчера";
    else label = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
    return `<div class="chat-date-divider"><span>${label}</span></div>`;
}

function renderChat(userId){
    const user = getUser(userId);
    const allMessages = db.messages.filter(m => (m.from === currentUserId && m.to === userId) || (m.from === userId && m.to === currentUserId)).sort((a,b) => a.createdAt - b.createdAt);
    // Only the tail is actually rendered into the DOM at first — a
    // long-running friendship can easily have thousands of messages, and
    // building/decrypting/laying out that whole history every time you
    // just open the chat (you always land at the bottom anyway) is real,
    // needless jank. "Показать более ранние" loads the rest on request,
    // same idea as the feed's "Показать ещё".
    const messages = allMessages.slice(-chatVisibleCount);
    const hasEarlier = allMessages.length > messages.length;
    const pinnedMessages = allMessages.filter(m => m.pinned);
    // Каждая переписка теперь всегда шифруется — нет отдельного шага
    // настройки на устройстве, поэтому бейдж больше не зависит от
    // publicKey/isReady, а просто отражает текущую схему.
    const chatEncrypted = true;

    return `

        <div class="chat-header">

            <img loading="lazy" decoding="async"
                class="mini-avatar${avatarFrameClass(user)}"
                src="${user.avatar || defaultAvatar()}"
                style="width:30px;height:30px;vertical-align:middle;cursor:pointer;"
                onclick="navigate('profile','${user.id}')"
            >

            <div style="display:flex;flex-direction:column;">
                <span style="cursor:pointer;" onclick="navigate('profile','${user.id}')">${escapeHtml(user.displayName)} ${subBadge(user, { fontSize: "9px" })}</span>
                <small id="chatPartnerStatus" class="chat-partner-status">${isUserOnline(user.lastSeen) ? "🟢 Онлайн" : "⚪ Не в сети"}</small>
            </div>

            <span class="chat-encryption-badge" title="${chatEncrypted ? "Сообщения шифруются" : "Сообщения НЕ шифруются"}">${chatEncrypted ? "🔒" : "🔓"}</span>

            <button
                type="button"
                class="chat-call-btn"
                onclick="toggleChatSearch()"
                title="Поиск по переписке"
            >🔎</button>

            <button
                type="button"
                class="chat-call-btn"
                onclick="startDirectCall('${userId}')"
                title="Позвонить"
            >📞</button>

        </div>

        ${
            chatSearchOpen
            ? `
                <div class="chat-search-bar">
                    <input id="chatSearchInput" placeholder="Поиск по переписке..." value="${escapeHtml(chatSearchQuery)}" oninput="setChatSearchQuery(this.value)">
                    <div id="chatSearchResults" class="chat-search-results"></div>
                </div>
              `
            : ""
        }

        ${
            pinnedMessages.length
            ? `
                <div class="room-pinned-section chat-pinned-section">
                    <div class="room-pinned-label">📌 Закреплённые</div>
                    ${pinnedMessages.map(m => `<div class="room-pinned-item" onclick="jumpToMessageInChat('${m.id}')">${escapeHtml(messagePreviewText(m).slice(0, 80))}</div>`).join("")}
                </div>
              `
            : ""
        }

        <div
            class="chat-messages"
            id="chatMessages"
        >

            ${
                hasEarlier
                ? `
                    <button type="button" id="loadEarlierMessagesBtn" class="secondary full profile-expand-btn" onclick="loadEarlierMessages('${userId}')">
                        ⬆️ Показать более ранние (${allMessages.length - messages.length})
                    </button>
                  `
                : ""
            }

            ${
                messages.length
                ? messages.map((m, i) => {
                    const prev = messages[i - 1];
                    const sameDay = prev && new Date(prev.createdAt).toDateString() === new Date(m.createdAt).toDateString();
                    return (sameDay ? "" : chatDateDivider(m.createdAt)) + messageBubble(m);
                  }).join("")
                : `
                    <div class="empty">
                        Начни переписку.
                    </div>
                `
            }

        </div>

        <div id="typingIndicator" class="typing-indicator hidden">${escapeHtml(user.displayName)} печатает…</div>

        <div id="replyPreviewBar" class="hidden"></div>

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
    const repliedTo = message.replyToId ? db.messages.find(m => m.id === message.replyToId) : null;

    return `

        <div class="message ${mine ? "me" : "them"}${message.image ? " has-image" : ""}" data-bubbles-message-id="${message.id}">

            ${message.pinned ? `<div class="message-pinned-tag">📌 Закреплено</div>` : ""}

            ${
                message.replyToId
                ? (
                    repliedTo
                    ? `
                        <div class="message-reply-quote" onclick="scrollToMessage('${repliedTo.id}')">
                            <strong>${escapeHtml(repliedTo.from === currentUserId ? "Вы" : (getUser(repliedTo.from)?.displayName || "Пользователь"))}</strong>
                            <span>${escapeHtml((messagePreviewText(repliedTo) || "").slice(0, 80))}</span>
                        </div>
                      `
                    : `<div class="message-reply-quote unavailable">Сообщение недоступно</div>`
                  )
                : ""
            }

            ${message.image ? `<img loading="lazy" decoding="async" class="message-image" src="${message.image}" onclick="viewChatImage(this.src)">` : ""}

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
                ${message.editedAt ? `<span class="message-edited-tag">изменено</span>` : ""}
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

                <button
                    type="button"
                    class="reaction-add-btn"
                    onclick="startReplyToMessage('${message.id}')"
                    title="Ответить"
                >↩️</button>

                <button
                    type="button"
                    class="reaction-add-btn"
                    onclick="openForwardPicker('${message.id}')"
                    title="Переслать"
                >↪️</button>

                <button
                    type="button"
                    class="reaction-add-btn"
                    onclick="toggleMessagePin('${message.id}')"
                    title="${message.pinned ? "Открепить" : "Закрепить"}"
                >📌</button>

                ${
                    mine && message.text && !sharedPost
                    ? `
                        <button
                            type="button"
                            class="reaction-add-btn"
                            onclick="startEditMessage('${message.id}')"
                            title="Редактировать"
                        >✏️</button>
                      `
                    : ""
                }

                ${
                    mine
                    ? `
                        <button
                            type="button"
                            class="reaction-add-btn"
                            onclick="deleteMessage('${message.id}')"
                            title="Удалить"
                        >🗑</button>
                      `
                    : ""
                }

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
                    ${
                        isSubscriber(getCurrentUser())
                        ? PLUS_REACTIONS.map(emoji => `
                            <button
                                type="button"
                                title="💎 Bubbles+"
                                onclick="toggleMessageReaction('${message.id}','${emoji}');closeReactionPickers();"
                            >
                                ${emoji}
                            </button>
                        `).join("")
                        : ""
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

// Starts (or switches) the reply-to-message compose state for the
// currently open chat — shows a small "replying to…" strip above the
// input, same idea as the image-attach preview right below it.
function startReplyToMessage(messageId) {
    const message = db.messages.find(m => m.id === messageId);
    if (!message) return;
    editingMessageId = null; // reply and edit are mutually exclusive compose states
    replyingToMessageId = messageId;
    renderReplyPreviewBar();
    document.getElementById("messageInput")?.focus();
}

function cancelReplyToMessage() {
    replyingToMessageId = null;
    renderReplyPreviewBar();
}

function startEditMessage(messageId) {
    const message = db.messages.find(m => m.id === messageId);
    if (!message || message.from !== currentUserId || !message.text || parseSharedPostMessage(message.text)) return;
    replyingToMessageId = null;
    editingMessageId = messageId;
    renderReplyPreviewBar();
    const input = document.getElementById("messageInput");
    if (input) { input.value = message.text; input.focus(); }
}

function cancelEditMessage() {
    editingMessageId = null;
    const input = document.getElementById("messageInput");
    if (input) input.value = "";
    renderReplyPreviewBar();
}

// Renders whichever compose-state bar applies above the input — replying
// to a message, editing one of your own, or neither (hidden). The two
// are mutually exclusive (see startReplyToMessage/startEditMessage
// above each clearing the other), so only one branch here ever applies
// at a time.
function renderReplyPreviewBar() {
    const el = document.getElementById("replyPreviewBar");
    if (!el) return;

    if (editingMessageId) {
        const original = db.messages.find(m => m.id === editingMessageId);
        if (!original) { editingMessageId = null; el.innerHTML = ""; el.classList.add("hidden"); return; }
        el.classList.remove("hidden");
        el.innerHTML = `
            <div class="reply-preview-bar edit-preview-bar">
                <div class="reply-preview-text">
                    <strong>✏️ Редактирование</strong>
                </div>
                <button type="button" class="message-image-remove" onclick="cancelEditMessage()" title="Отменить редактирование">✕</button>
            </div>
        `;
        return;
    }

    if (!replyingToMessageId) {
        el.innerHTML = "";
        el.classList.add("hidden");
        return;
    }
    const original = db.messages.find(m => m.id === replyingToMessageId);
    if (!original) {
        replyingToMessageId = null;
        el.innerHTML = "";
        el.classList.add("hidden");
        return;
    }
    const author = getUser(original.from);
    const authorName = original.from === currentUserId ? "Вы" : (author?.displayName || "Пользователь");
    const preview = messagePreviewText(original) || "";
    el.classList.remove("hidden");
    el.innerHTML = `
        <div class="reply-preview-bar">
            <div class="reply-preview-text">
                <strong>↩ ${escapeHtml(authorName)}</strong>
                <span>${escapeHtml(preview.length > 60 ? preview.slice(0, 60) + "…" : preview)}</span>
            </div>
            <button type="button" class="message-image-remove" onclick="cancelReplyToMessage()" title="Отменить ответ">✕</button>
        </div>
    `;
}

// Tapping a quoted reply inside a bubble jumps to (and briefly
// highlights) the original message, if it's still loaded in this chat.
function scrollToMessage(messageId) {
    const el = document.querySelector(`[data-bubbles-message-id="${messageId}"]`);
    if (!el) {
        toast("Исходное сообщение не найдено.");
        return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("message-highlight");
    setTimeout(() => el.classList.remove("message-highlight"), 1200);
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
    document.querySelectorAll(".reaction-picker, .post-reaction-picker").forEach(el => el.classList.add("hidden"));
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
    overlay.innerHTML = `<img loading="lazy" decoding="async" src="${src}">`;
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
        .subscribe(logRealtimeStatus("typing:" + partnerId));
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

    playSound("message");

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

            <img loading="lazy" decoding="async"
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
            const bubbleEl = wrapper.firstElementChild;
            bubbleEl?.classList.add("message-appear");
            box.appendChild(bubbleEl);
            box.scrollTop = box.scrollHeight;
            // A new message pushes the total past the visible window too,
            // so "Показать более ранние" (if it exists) doesn't quietly
            // under-count how many messages are actually still hidden.
            chatVisibleCount++;
        }
    }
    refreshConversationPreview(partnerId);
}

// Prepends the next-older batch to the TOP of the chat instead of
// re-rendering the whole thing — same idea as loadMoreFeedPosts().
// Manually restoring scrollTop after prepending is essential here: the
// browser doesn't do it for you, and without it the message you were
// just reading jumps to a completely different spot on screen.
function loadEarlierMessages(userId){
    const box = document.getElementById("chatMessages");
    if (!box) return;
    const allMessages = db.messages.filter(m => (m.from === currentUserId && m.to === userId) || (m.from === userId && m.to === currentUserId)).sort((a,b) => a.createdAt - b.createdAt);
    const alreadyShown = chatVisibleCount;
    chatVisibleCount = Math.min(allMessages.length, chatVisibleCount + CHAT_PAGE_SIZE);
    const earlierBatch = allMessages.slice(-chatVisibleCount, -alreadyShown || undefined);

    const prevScrollHeight = box.scrollHeight;
    const prevScrollTop = box.scrollTop;

    const btn = document.getElementById("loadEarlierMessagesBtn");
    const remaining = allMessages.length - chatVisibleCount;
    const batchHtml = earlierBatch.map(messageBubble).join("");

    // Insert the batch FIRST, while the button (if any) is still attached
    // to the document — inserting "afterend" relative to a node that's
    // already been removed silently does nothing.
    if (btn) btn.insertAdjacentHTML("afterend", batchHtml);
    else box.insertAdjacentHTML("afterbegin", batchHtml);

    if (btn) {
        if (remaining > 0) btn.textContent = `⬆️ Показать более ранние (${remaining})`;
        else btn.remove();
    }

    // Keep whatever was on screen anchored in place rather than snapping
    // back to the very top of the now-taller message list.
    box.scrollTop = prevScrollTop + (box.scrollHeight - prevScrollHeight);
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
async function buildEncryptedMessageRow(id, toUserId, text, image, createdAtIso, replyToId){
    const row = {
        id,
        sender_id: currentUserId,
        receiver_id: toUserId,
        created_at: createdAtIso,
        reply_to_id: replyToId || null
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
    if (editingMessageId) { await saveEditedMessage(userId); return; }
    stopTyping();
    const input = document.getElementById("messageInput");
    const text = input.value.trim();
    const image = selectedMessageImage || "";
    if (!text && !image)
        return;
    input.value = "";
    removeMessageImage();
    const replyToId = replyingToMessageId;
    cancelReplyToMessage();
    // Shown locally right away in plaintext — we already know the plaintext,
    // no need to round-trip through decryption for our own optimistic bubble.
    const message = { id: uid("message"), from: currentUserId, to: userId, text, image, replyToId, createdAt: Date.now(), readAt: null, reactions: [] };
    db.messages.push(message);
    appendMessageToChat(message, userId);
    haptic("tap");

    const row = await buildEncryptedMessageRow(message.id, userId, text, image, new Date(message.createdAt).toISOString(), replyToId);

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

// Re-encrypts with a FRESH iv (never reuse an AES-GCM iv with a new
// ciphertext under the same key) via the same buildEncryptedMessageRow
// used for sending — this is an update to the existing row, not a new
// message, so only text/iv/encrypted/edited_at are touched.
async function saveEditedMessage(userId) {
    const input = document.getElementById("messageInput");
    const newText = input?.value.trim();
    const message = db.messages.find(m => m.id === editingMessageId);
    if (!message || !newText) return;
    const messageId = editingMessageId;
    const prevText = message.text;
    const prevEditedAt = message.editedAt;

    message.text = newText;
    message.editedAt = Date.now();
    input.value = "";
    cancelEditMessage();
    refreshMessageBubbleInPlace(messageId);

    const row = await buildEncryptedMessageRow(messageId, userId, newText, "", new Date(message.createdAt).toISOString(), message.replyToId);
    const { error } = await sb.from("messages")
        .update({ text: row.text, iv: row.iv || null, encrypted: row.encrypted, edited_at: new Date(message.editedAt).toISOString() })
        .eq("id", messageId);

    if (error) {
        console.error(error);
        message.text = prevText;
        message.editedAt = prevEditedAt;
        refreshMessageBubbleInPlace(messageId);
        toast("Не удалось сохранить изменения.");
    }
}

async function deleteMessage(messageId) {
    const message = db.messages.find(m => m.id === messageId);
    if (!message || message.from !== currentUserId) return;
    if (!confirm("Удалить сообщение? Действие нельзя отменить.")) return;
    const partnerId = message.to;
    db.messages = db.messages.filter(m => m.id !== messageId);
    document.querySelector(`[data-bubbles-message-id="${messageId}"]`)?.remove();
    refreshConversationPreview(partnerId);

    const { error } = await sb.from("messages").delete().eq("id", messageId);
    if (error) {
        console.error(error);
        db.messages.push(message);
        if (selectedChatId === partnerId) renderMessages();
        toast("Не удалось удалить сообщение.");
    }
}

function openForwardPicker(messageId) {
    const message = db.messages.find(m => m.id === messageId);
    if (!message) return;
    const friends = db.friends
        .filter(f => f.user1 === currentUserId || f.user2 === currentUserId)
        .map(f => getUser(f.user1 === currentUserId ? f.user2 : f.user1))
        .filter(Boolean);

    showBubblesModal(`
        <div class="modal-header">
            <h3>Переслать</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        ${
            friends.length
            ? `
                <div class="share-friend-list">
                    ${friends.map(f => `
                        <button class="share-friend-row" onclick="forwardMessageTo('${messageId}','${f.id}')">
                            <img loading="lazy" decoding="async" class="mini-avatar small" src="${f.avatar || defaultAvatar()}">
                            <span>${escapeHtml(f.displayName)}</span>
                        </button>
                    `).join("")}
                </div>
              `
            : `<p style="text-align:center;color:var(--muted);padding:20px 0;">Пока нет друзей, чтобы переслать.</p>`
        }
    `);
}

async function forwardMessageTo(messageId, toUserId) {
    const original = db.messages.find(m => m.id === messageId);
    if (!original) return;
    closeBubblesModal();

    const message = { id: uid("message"), from: currentUserId, to: toUserId, text: original.text, image: original.image, createdAt: Date.now(), readAt: null, reactions: [] };
    db.messages.push(message);
    appendMessageToChat(message, toUserId);

    const row = await buildEncryptedMessageRow(message.id, toUserId, original.text, original.image, new Date(message.createdAt).toISOString());
    const { error } = await sb.from("messages").insert(row);
    if (error) {
        console.error(error);
        db.messages = db.messages.filter(m => m.id !== message.id);
        document.querySelector(`[data-bubbles-message-id="${message.id}"]`)?.remove();
        toast("Не удалось переслать сообщение.");
        return;
    }
    toast("Переслано ↪️");
}

// Либо сторона DM может закрепить/открепить — см. заметки про
// messages_guard_update в supabase.sql: ни sender-, ни receiver-ветка
// не запрещают менять pinned/pinned_at, так что это разрешено обеим
// сторонам без изменений RLS.
async function toggleMessagePin(messageId) {
    const message = db.messages.find(m => m.id === messageId);
    if (!message) return;
    const wasPinned = message.pinned;
    message.pinned = !wasPinned;
    message.pinnedAt = message.pinned ? Date.now() : null;
    if (selectedChatId) renderMessages();

    const { error } = await sb.from("messages")
        .update({ pinned: message.pinned, pinned_at: message.pinned ? new Date().toISOString() : null })
        .eq("id", messageId);

    if (error) {
        console.error(error);
        message.pinned = wasPinned;
        message.pinnedAt = wasPinned ? message.pinnedAt : null;
        if (selectedChatId) renderMessages();
        toast("Не удалось закрепить сообщение.");
    }
}

function toggleChatSearch() {
    chatSearchOpen = !chatSearchOpen;
    if (!chatSearchOpen) chatSearchQuery = "";
    renderMessages();
    if (chatSearchOpen) document.getElementById("chatSearchInput")?.focus();
}

let chatSearchDebounceTimer = null;
function setChatSearchQuery(value) {
    chatSearchQuery = value;
    clearTimeout(chatSearchDebounceTimer);
    chatSearchDebounceTimer = setTimeout(renderChatSearchResults, 150);
}

function renderChatSearchResults() {
    const box = document.getElementById("chatSearchResults");
    if (!box) return;
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) { box.innerHTML = ""; return; }
    const partnerId = selectedChatId;
    const matches = db.messages
        .filter(m =>
            ((m.from === currentUserId && m.to === partnerId) || (m.from === partnerId && m.to === currentUserId)) &&
            m.text && !parseSharedPostMessage(m.text) && m.text.toLowerCase().includes(q)
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 30);

    box.innerHTML = matches.length
        ? matches.map(m => `
            <button type="button" class="chat-search-result" onclick="jumpToMessageInChat('${m.id}')">
                <span>${escapeHtml(m.text.length > 70 ? m.text.slice(0, 70) + "…" : m.text)}</span>
                <small>${new Date(m.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}</small>
            </button>
        `).join("")
        : `<p style="text-align:center;color:var(--muted);padding:10px 0;">Ничего не найдено.</p>`;
}

// Unlike scrollToMessage (used for reply-quote jumps, where the target
// is almost always already on screen), a search hit can easily be
// outside the last-40-messages window renderChat actually puts in the
// DOM — so this widens that window first if needed, then scrolls.
function jumpToMessageInChat(messageId) {
    const message = db.messages.find(m => m.id === messageId);
    if (!message) { toast("Сообщение не найдено."); return; }
    const partnerId = message.from === currentUserId ? message.to : message.from;
    chatSearchOpen = false;
    chatSearchQuery = "";
    if (selectedChatId !== partnerId) selectedChatId = partnerId;

    const allMessages = db.messages
        .filter(m => (m.from === currentUserId && m.to === partnerId) || (m.from === partnerId && m.to === currentUserId))
        .sort((a, b) => a.createdAt - b.createdAt);
    const idx = allMessages.findIndex(m => m.id === messageId);
    const fromEnd = allMessages.length - idx;
    if (fromEnd > chatVisibleCount) chatVisibleCount = fromEnd + 5;

    renderMessages();
    setTimeout(() => scrollToMessage(messageId), 60);
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

    const recentPlayedTracks = myRecentPlays
        .slice(0, 5)
        .map(p => db.music.find(m => m.id === p.musicId))
        .filter(Boolean);

    // Lightweight "recommendations": a handful of tracks you haven't
    // already saved, liked, or played — not a real ranking model, just
    // enough to surface stuff you haven't seen yet. Reshuffles on every
    // visit to the Music page.
    const seenIds = new Set([...mySavedMusicIds, ...myRecentPlays.map(p => p.musicId)]);
    const recommendedTracks = db.music
        .filter(m => m.authorId !== currentUserId && !seenIds.has(m.id))
        .sort(() => Math.random() - 0.5)
        .slice(0, 5);

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
            musicTab === "all" && !musicSearchQuery.trim()
            ? `
                <div class="rooms-topbar">
                    <h3 class="rooms-subheading" style="margin:0;">📃 Мои плейлисты</h3>
                    <div class="rooms-header-actions">
                        <button type="button" class="secondary" onclick="openAddToPlaylistModal(null)">+ Плейлист</button>
                    </div>
                </div>
                ${
                    myPlaylists().length
                    ? `<div class="playlist-row">${myPlaylists().map(p => `
                        <button type="button" class="playlist-chip" onclick="navigate('playlist','${p.id}')">📃 ${escapeHtml(p.name)} <small>${tracksInPlaylist(p.id).length}</small></button>
                    `).join("")}</div>`
                    : `<p class="wall-subtitle">Плейлистов пока нет — создай первый.</p>`
                }

                ${
                    recentPlayedTracks.length
                    ? `<h3 class="rooms-subheading">🕓 Недавно прослушанное</h3>${recentPlayedTracks.map(renderMusicCard).join("")}`
                    : ""
                }

                ${
                    recommendedTracks.length
                    ? `<h3 class="rooms-subheading">✨ Рекомендуем</h3>${recommendedTracks.map(renderMusicCard).join("")}`
                    : ""
                }

                <h3 class="rooms-subheading">Все треки</h3>
            `
            : ""
        }

        ${
            musicTab === "mine"
            ? `
                <div class="card">
                    <h3>Опубликовать музыку</h3>
                    <div class="form-group"><label>Название трека</label><input id="musicTitle" maxlength="80" placeholder="Название"></div>
                    <div class="form-group"><label>Имя артиста</label><input id="musicArtist" maxlength="80" placeholder="Имя Артиста"></div>
                    <div class="form-group">
                        <label>Обложка</label>
                        <input id="musicCover" type="file" accept="image/png,image/jpeg,image/webp" onchange="onMusicCoverFileChosen(this)">
                        <img loading="lazy" decoding="async" id="musicCoverPreview" style="width:120px;height:120px;object-fit:cover;border-radius:12px;margin-top:8px;display:none;">
                    </div>
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
    replayPageTransition();
}

function setMusicSearch(value) {
    musicSearchQuery = value;
    // Purely client-side filtering (db.music is already in memory) —
    // still worth debouncing renderMusic() itself, since that's a full
    // page rebuild and fast typing was re-running it on every keystroke.
    clearTimeout(musicSearchDebounceTimer);
    musicSearchDebounceTimer = setTimeout(() => {
        renderMusic();
        // Keep focus + caret in the search box after the re-render.
        const input = document.getElementById("musicSearchInput");
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }, 150);
}

function setMusicAutoplay(value) {
    musicAutoplay = value;
}

function renderMusicCard(music) {
    const author = getUser(music.authorId);
    const isPlaying = currentlyPlayingMusicId === music.id;
    const isMine = music.authorId === currentUserId;
    const isSaved = mySavedMusicIds.has(music.id);
    const liked = (music.likes || []).includes(currentUserId);
    return `
        <div class="music-card ${isPlaying ? "playing" : ""}" id="music-${music.id}">
            <div class="music-row">
                <img loading="lazy" decoding="async" class="music-cover" src="${music.cover || defaultMusicCover()}">
                <div class="music-info">
                    <div class="music-title">${escapeHtml(music.title)}</div>
                    <div class="music-artist">${escapeHtml(music.artist || "Unknown Artist")}</div>
                    <div class="music-artist music-author-link" onclick="navigate('profile','${music.authorId}')">@${escapeHtml(author?.username || "unknown")}</div>
                </div>
                <button class="music-like-btn ${liked ? "liked" : ""}" onclick="toggleMusicLike('${music.id}')" title="${liked ? "Убрать лайк" : "Нравится"}">
                    ${liked ? "❤️" : "🤍"}${music.likes?.length ? `<span>${music.likes.length}</span>` : ""}
                </button>
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
                <button onclick="openAddToPlaylistModal('${music.id}')" title="Добавить в плейлист">➕📃</button>
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

async function toggleMusicLike(musicId) {
    const track = db.music.find(m => m.id === musicId);
    if (!track) return;
    if (!track.likes) track.likes = [];
    const wasLiked = track.likes.includes(currentUserId);
    track.likes = wasLiked ? track.likes.filter(id => id !== currentUserId) : [...track.likes, currentUserId];
    refreshMusicCardInPlace(musicId);

    const { error } = wasLiked
        ? await sb.from("music_likes").delete().eq("music_id", musicId).eq("user_id", currentUserId)
        : await sb.from("music_likes").insert({ music_id: musicId, user_id: currentUserId });

    if (error) {
        console.error(error);
        track.likes = wasLiked ? [...track.likes, currentUserId] : track.likes.filter(id => id !== currentUserId);
        refreshMusicCardInPlace(musicId);
        toast("Не удалось поставить лайк.");
    }
}

function refreshMusicCardInPlace(musicId) {
    const track = db.music.find(m => m.id === musicId);
    const card = document.getElementById("music-" + musicId);
    if (!track || !card) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderMusicCard(track).trim();
    card.replaceWith(wrapper.firstElementChild);
}

/* ------------------------------------------------------------
   PLAYLISTS
   ------------------------------------------------------------ */
function myPlaylists() {
    return db.playlists.filter(p => p.ownerId === currentUserId);
}

function tracksInPlaylist(playlistId) {
    return db.playlistTracks
        .filter(t => t.playlistId === playlistId)
        .sort((a, b) => a.position - b.position)
        .map(t => db.music.find(m => m.id === t.musicId))
        .filter(Boolean);
}

function openAddToPlaylistModal(musicId) {
    const playlists = myPlaylists();
    showBubblesModal(`
        <div class="modal-header">
            <h3>${musicId ? "Добавить в плейлист" : "Новый плейлист"}</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        ${
            musicId && playlists.length
            ? `
                <div class="friend-grid" style="grid-template-columns:1fr;">
                    ${playlists.map(p => `
                        <button class="share-friend-row" onclick="addTrackToPlaylist('${p.id}','${musicId}')">
                            <span>📃 ${escapeHtml(p.name)}</span>
                            <small style="color:var(--muted);">${tracksInPlaylist(p.id).length} треков</small>
                        </button>
                    `).join("")}
                </div>
              `
            : musicId ? `<p style="text-align:center;color:var(--muted);">Плейлистов пока нет.</p>` : ""
        }
        <div class="room-create-form" style="margin-top:12px;">
            <input id="newPlaylistNameModal" maxlength="60" placeholder="Название нового плейлиста">
            <button type="button" class="primary full" onclick="createPlaylistAndAdd(${musicId ? `'${musicId}'` : "null"})">+ Создать${musicId ? " и добавить" : ""}</button>
        </div>
    `);
}

async function createPlaylistAndAdd(musicId) {
    const name = document.getElementById("newPlaylistNameModal")?.value.trim();
    if (!name) { toast("Дай плейлисту название."); return; }
    const { data, error } = await sb.from("playlists").insert({ owner_id: currentUserId, name }).select("id,created_at").single();
    if (error) { console.error(error); toast("Не удалось создать плейлист."); return; }
    db.playlists.push({ id: data.id, ownerId: currentUserId, name, createdAt: Date.parse(data.created_at) });
    if (musicId) await addTrackToPlaylist(data.id, musicId);
    else closeBubblesModal();
}

async function addTrackToPlaylist(playlistId, musicId) {
    if (db.playlistTracks.some(t => t.playlistId === playlistId && t.musicId === musicId)) {
        toast("Уже в этом плейлисте.");
        closeBubblesModal();
        return;
    }
    const position = tracksInPlaylist(playlistId).length;
    const { data, error } = await sb.from("playlist_tracks")
        .insert({ playlist_id: playlistId, music_id: musicId, position })
        .select("id,added_at").single();
    if (error) { console.error(error); toast("Не удалось добавить трек."); return; }
    db.playlistTracks.push({ id: data.id, playlistId, musicId, position, addedAt: Date.parse(data.added_at) });
    toast("Добавлено в плейлист 📃");
    closeBubblesModal();
    if (currentPage === "music") renderMusic();
}

async function removeTrackFromPlaylist(playlistId, musicId) {
    const entry = db.playlistTracks.find(t => t.playlistId === playlistId && t.musicId === musicId);
    if (!entry) return;
    db.playlistTracks = db.playlistTracks.filter(t => t.id !== entry.id);
    renderPlaylistPage(playlistId);
    const { error } = await sb.from("playlist_tracks").delete().eq("id", entry.id);
    if (error) { console.error(error); toast("Не удалось убрать трек."); }
}

async function deletePlaylist(playlistId) {
    if (!confirm("Удалить плейлист?")) return;
    const { error } = await sb.from("playlists").delete().eq("id", playlistId);
    if (error) { console.error(error); toast("Не удалось удалить плейлист."); return; }
    db.playlists = db.playlists.filter(p => p.id !== playlistId);
    db.playlistTracks = db.playlistTracks.filter(t => t.playlistId !== playlistId);
    renderMusic();
}

function playPlaylist(playlistId) {
    const tracks = tracksInPlaylist(playlistId);
    if (!tracks.length) return;
    musicQueue = tracks.map(t => t.id);
    playMusic(tracks[0].id);
}

function renderPlaylistPage(playlistId) {
    const playlist = db.playlists.find(p => p.id === playlistId);
    const page = document.getElementById("page");
    if (!playlist) { page.innerHTML = emptyState("📃", "Плейлист не найден", ""); return; }
    const tracks = tracksInPlaylist(playlistId);
    const isMine = playlist.ownerId === currentUserId;

    page.innerHTML = `
        <div class="rooms-topbar">
            <h1 class="section-title" style="margin-bottom:0;">📃 ${escapeHtml(playlist.name)}</h1>
            <div class="rooms-header-actions">
                ${tracks.length ? `<button type="button" class="primary" onclick="playPlaylist('${playlistId}')">▶️ Играть всё</button>` : ""}
                ${isMine ? `<button type="button" class="secondary" onclick="deletePlaylist('${playlistId}')">🗑</button>` : ""}
            </div>
        </div>
        ${
            tracks.length
            ? tracks.map(t => `
                <div class="music-card" id="music-${t.id}">
                    <div class="music-row">
                        <img loading="lazy" decoding="async" class="music-cover" src="${t.cover || defaultMusicCover()}">
                        <div class="music-info">
                            <div class="music-title">${escapeHtml(t.title)}</div>
                            <div class="music-artist">${escapeHtml(t.artist || "Unknown Artist")}</div>
                        </div>
                        <button onclick="playMusic('${t.id}')" title="Слушать">${currentlyPlayingMusicId === t.id ? "⏸️" : "▶️"}</button>
                        ${isMine ? `<button onclick="removeTrackFromPlaylist('${playlistId}','${t.id}')" title="Убрать из плейлиста">✕</button>` : ""}
                    </div>
                </div>
            `).join("")
            : emptyState("📃", "Плейлист пуст", "Добавляй треки кнопкой ➕📃 на карточке трека.")
        }
    `;
}

async function onMusicCoverFileChosen(input){
    const file = input.files[0];
    if(!file) return;
    if(!file.type.startsWith("image/")){
        toast("Выбери изображение.");
        input.value = "";
        return;
    }
    const blob = await openImageCropper(file, { aspect: 1, outputSize: 800 });
    input.value = "";
    if (!blob) return;
    pendingMusicCoverBlob = blob;
    const preview = document.getElementById("musicCoverPreview");
    preview.src = URL.createObjectURL(blob);
    preview.style.display = "";
}

async function uploadMusic() {
    const title = document.getElementById("musicTitle").value.trim();
    const artist = document.getElementById("musicArtist").value.trim();
    const audioFile = document.getElementById("musicFile").files[0];
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
    const musicId = uid("music");
    const audioPath = `${currentUserId}/${musicId}.mp3`;
    const coverPath = pendingMusicCoverBlob ? `${currentUserId}/${musicId}-cover.jpg` : "";
    try {
        toast("Загружаю трек в Supabase…");
        let result = await sb.storage.from(MUSIC_BUCKET).upload(audioPath, audioFile, { contentType: "audio/mpeg", upsert: false });
        if (result.error)
            throw result.error;
        let audioUrl = sb.storage.from(MUSIC_BUCKET).getPublicUrl(audioPath).data.publicUrl;
        let coverUrl = "";
        if (pendingMusicCoverBlob) {
            result = await sb.storage.from(MUSIC_BUCKET).upload(coverPath, pendingMusicCoverBlob, { contentType: "image/jpeg", upsert: false });
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
        pendingMusicCoverBlob = null;
        const coverPreview = document.getElementById("musicCoverPreview");
        if (coverPreview) coverPreview.style.display = "none";
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
    document.body.classList.add("player-open");
    setListening(music.title, music.artist || "Unknown Artist");
    refreshMusicCardPlayState(musicId);
    updateMediaSessionMetadata(music);
    if (!document.getElementById("fullPlayer")?.classList.contains("hidden")) renderFullPlayer();

    // If this track isn't part of the currently-viewed list (e.g. played
    // from a profile page), fall back to a queue of just this one track.
    if (!musicQueue.includes(musicId)) musicQueue = [musicId];

    try{ await audio.play(); }catch(error){ console.log("Браузер ожидает действие пользователя.",error); }
    logMusicPlay(musicId);
}

// Debounced: replaying/scrubbing the same track within a few minutes
// doesn't spam music_plays with near-duplicate rows — one row per
// genuine "started listening to this again" moment is enough for a
// recently-played list.
async function logMusicPlay(musicId) {
    if (!currentUserId) return;
    const now = Date.now();
    const last = lastPlayLoggedAt.get(musicId);
    if (last && now - last < 5 * 60 * 1000) return;
    lastPlayLoggedAt.set(musicId, now);

    myRecentPlays = myRecentPlays.filter(p => p.musicId !== musicId);
    myRecentPlays.unshift({ musicId, playedAt: now });
    myRecentPlays = myRecentPlays.slice(0, 200);

    const { error } = await sb.from("music_plays").insert({ music_id: musicId, user_id: currentUserId });
    if (error) console.error(error);
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
    document.body.classList.remove("player-open");
    setListening("", "");
    if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
    }
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
                ${isSubscriber(user) ? ` · 💎 Plus ещё ${subscriptionDaysLeft(user)} дн.` : ""}
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

        <div class="card" style="margin-top:14px;">
            <h3 style="margin-top:0;">💎 Bubbles+</h3>
            <div style="opacity:.7;font-size:14px;margin-bottom:10px;">
                ${
                    isSubscriber(user)
                    ? `Активна до ${new Date(user.subscriptionExpiresAt).toLocaleDateString("ru-RU")} (ещё ${subscriptionDaysLeft(user)} дн.)`
                    : "Подписки сейчас нет."
                }
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="secondary" onclick="adminGrantSubscription('${user.id}',1)">+1 мес.</button>
                <button class="secondary" onclick="adminGrantSubscription('${user.id}',6)">+6 мес.</button>
                <button class="secondary" onclick="adminGrantSubscription('${user.id}',12)">+12 мес.</button>
                ${
                    isSubscriber(user)
                    ? `<button class="danger" onclick="adminRevokeSubscription('${user.id}')">Отключить подписку</button>`
                    : ""
                }
            </div>
        </div>
    `;
}

// Manual grant, entirely separate from a subscription_requests flow —
// for the case an admin just wants to hand someone Bubbles+ directly
// (a gift, a moderator perk, fixing a payment that came through some
// channel that never made it into a request). Stacks on top of any
// remaining active time, exactly like approve_subscription_request does.
async function adminGrantSubscription(userId, months) {
    if (!isAdmin()) return;
    const user = getUser(userId);
    if (!user) return;
    if (!confirm(`Выдать ${user.displayName} подписку Bubbles+ на ${months} мес.?`)) return;
    const base = isSubscriber(user) ? user.subscriptionExpiresAt : Date.now();
    const expiresAt = new Date(base + months * 30 * 86400000);
    const { error } = await sb.from("profiles")
        .update({ subscription_tier: "plus", subscription_expires_at: expiresAt.toISOString() })
        .eq("id", userId);
    if (error) { console.error(error); toast("Не удалось выдать подписку."); return; }
    user.subscriptionTier = "plus";
    user.subscriptionExpiresAt = expiresAt.getTime();
    toast(`Bubbles+ выдана: ${user.displayName}, +${months} мес.`);
    renderApp();
}

async function adminRevokeSubscription(userId) {
    if (!isAdmin()) return;
    const user = getUser(userId);
    if (!user) return;
    if (!confirm(`Отключить подписку у ${user.displayName}?`)) return;
    const { error } = await sb.from("profiles")
        .update({ subscription_tier: "free", subscription_expires_at: null })
        .eq("id", userId);
    if (error) { console.error(error); toast("Не удалось отключить подписку."); return; }
    user.subscriptionTier = "free";
    user.subscriptionExpiresAt = null;
    user.subscriptionFrame = "none";
    user.subscriptionTheme = "default";
    toast("Подписка отключена.");
    renderApp();
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
                <img loading="lazy" decoding="async"
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
        const post = db.posts.find(p => p.id === report.targetId);
        const [postResult, commentResult] = await Promise.all([
            sb.from("posts").delete().eq("id", report.targetId),
            sb.from("comments").delete().eq("post_id", report.targetId)
        ]);
        if (postResult.error || commentResult.error) {
            toast("Не удалось удалить пост.");
            return;
        }
        if (post?.image) {
            sb.storage.from(IMAGES_BUCKET).remove([`${post.authorId}/post-${post.id}.jpg`]).catch(() => {});
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
   BUBBLES+ — subscription purchase + admin approval queue
   ============================================================ */

function pendingSubscriptionRequests() {
    return db.subscriptionRequests.filter(r => r.status === "pending").sort((a,b) => a.createdAt - b.createdAt);
}

// The current user's own request, if any — used on the purchase screen
// so it shows "заявка на рассмотрении" instead of the plan picker again.
function myPendingSubscriptionRequest() {
    return db.subscriptionRequests.find(r => r.userId === currentUserId && r.status === "pending") || null;
}

let selectedPlusMonths = 1;

function renderPremium() {
    const user = getCurrentUser();
    const pending = myPendingSubscriptionRequest();
    const subscribed = isSubscriber(user);

    document.getElementById("page").innerHTML = `

        <h1 class="section-title">💎 Bubbles+</h1>

        <div class="plus-hero">
            <div style="font-size:34px;">💎</div>
            <h2>Bubbles+</h2>
            <div>Рамка на аватар, эксклюзивные темы и стикеры.</div>
        </div>

        ${
            subscribed
            ? `
                <div class="card" style="margin-bottom:16px;">
                    <strong>Подписка активна</strong>
                    <div style="opacity:.75;font-size:14px;margin-top:6px;">
                        До ${new Date(user.subscriptionExpiresAt).toLocaleDateString("ru-RU")} (ещё ${subscriptionDaysLeft(user)} дн.). Можно продлить заранее — новые месяцы добавятся поверх текущих.
                    </div>
                </div>
            `
            : ""
        }

        ${
            pending
            ? `
                <div class="card" style="margin-bottom:16px;">
                    <strong>⏳ Заявка на рассмотрении</strong>
                    <div style="opacity:.75;font-size:14px;margin-top:6px;">
                        ${pending.months} мес. · отправлена ${timeAgo(pending.createdAt)}. Как только оплата подтвердится, подписку включат — обновлять страницу не нужно.
                    </div>
                </div>
            `
            : `
                <div class="card" style="margin-bottom:16px;">
                    <h3 style="margin-top:0;">Выбери срок</h3>
                    <div class="plus-plans">
                        ${SUBSCRIPTION_PLANS.map(plan => `
                            <div class="plus-plan${selectedPlusMonths === plan.months ? " selected" : ""}" onclick="selectPlusPlan(${plan.months})">
                                <div class="plus-plan-months">${plan.months} мес.</div>
                                <div class="plus-plan-price">${plan.price}${plan.perMonth ? ` · ${plan.perMonth}` : ""}</div>
                                ${plan.save ? `<div class="plus-plan-save">${plan.save}</div>` : ""}
                            </div>
                        `).join("")}
                    </div>

                    <div style="font-size:14px;opacity:.8;margin:14px 0;line-height:1.5;">
                        ${escapeHtml(PAYMENT_INSTRUCTIONS)}
                    </div>

                    <button class="primary" onclick="createSubscriptionRequest()">
                        Отправить заявку на ${selectedPlusMonths} мес.
                    </button>
                </div>
            `
        }

        <div class="card">
            <h3 style="margin-top:0;">Что входит</h3>

            <div style="margin-bottom:14px;">
                <strong>🖼️ Рамка на аватар</strong>
                <div class="perk-option-grid">
                    ${FRAME_OPTIONS.map(f => `
                        <div class="perk-option${subscribed && user.subscriptionFrame === f.id ? " selected" : ""}${subscribed ? "" : " locked"}"
                            ${subscribed ? `onclick="setSubscriptionFrame('${f.id}')"` : ""}
                            title="${subscribed ? "" : "Доступно с подпиской"}"
                        >
                            <span class="perk-swatch" style="background:${f.swatch}"></span>
                            ${f.label}
                        </div>
                    `).join("")}
                    <div class="perk-option${subscribed && user.subscriptionFrame === "none" ? " selected" : ""}${subscribed ? "" : " locked"}"
                        ${subscribed ? `onclick="setSubscriptionFrame('none')"` : ""}
                    >Без рамки</div>
                </div>
            </div>

            <div style="margin-bottom:14px;">
                <strong>🎨 Эксклюзивная тема</strong>
                <div class="perk-option-grid">
                    ${THEME_OPTIONS.map(t => `
                        <div class="perk-option${subscribed && user.subscriptionTheme === t.id ? " selected" : ""}${subscribed || t.id === "default" ? "" : " locked"}"
                            ${subscribed || t.id === "default" ? `onclick="setSubscriptionTheme('${t.id}')"` : ""}
                            title="${subscribed || t.id === "default" ? "" : "Доступно с подпиской"}"
                        >
                            <span class="perk-swatch" style="background:${t.swatch}"></span>
                            ${t.label}
                        </div>
                    `).join("")}
                </div>
            </div>

            <div>
                <strong>🫧 Эксклюзивные стикеры</strong>
                <div style="font-size:24px;margin-top:8px;${subscribed ? "" : "opacity:.4;"}">
                    ${PLUS_REACTIONS.join(" ")}
                </div>
                <div style="opacity:.7;font-size:13px;margin-top:4px;">
                    ${subscribed ? "Доступны в реакциях на сообщения." : "Появятся в реакциях на сообщения с активной подпиской."}
                </div>
            </div>
        </div>

    `;
}

function selectPlusPlan(months) {
    selectedPlusMonths = months;
    renderPremium();
}

async function createSubscriptionRequest() {
    if (!currentUserId) return;
    if (myPendingSubscriptionRequest()) return;
    const row = {
        id: uid("subreq"),
        user_id: currentUserId,
        months: selectedPlusMonths,
        status: "pending"
    };
    const { error } = await sb.from("subscription_requests").insert(row);
    if (error) {
        console.error(error);
        toast("Не удалось отправить заявку.");
        return;
    }
    db.subscriptionRequests.push(rowToSubscriptionRequest({ ...row, created_at: new Date().toISOString() }));
    toast("Заявка отправлена — подписку включат после подтверждения оплаты.");
    renderPremium();
}

// Frame/theme picks only ever stick while a subscription is actually
// active — see the protect_profile_role_columns trigger in supabase.sql,
// which silently resets both back to the free defaults server-side the
// instant it isn't, no matter what gets sent here.
async function setSubscriptionFrame(frame) {
    const user = getCurrentUser();
    if (!isSubscriber(user)) return;
    const { error } = await sb.from("profiles").update({ subscription_frame: frame }).eq("id", currentUserId);
    if (error) { console.error(error); toast("Не удалось сохранить рамку."); return; }
    user.subscriptionFrame = frame;
    toast("Рамка обновлена.");
    renderApp();
}

async function setSubscriptionTheme(themeId) {
    const user = getCurrentUser();
    if (themeId !== "default" && !isSubscriber(user)) return;
    const { error } = await sb.from("profiles").update({ subscription_theme: themeId }).eq("id", currentUserId);
    if (error) { console.error(error); toast("Не удалось сохранить тему."); return; }
    user.subscriptionTheme = themeId;
    applySubscriptionTheme(user);
    toast("Тема обновлена.");
    renderApp();
}

// Applies (or clears) the data-sub-theme attribute the CSS in
// style.css keys off of. Called once at startup and again any time the
// theme selection or subscription status changes.
function applySubscriptionTheme(user) {
    if (isSubscriber(user) && user.subscriptionTheme && user.subscriptionTheme !== "default") {
        document.documentElement.setAttribute("data-sub-theme", user.subscriptionTheme);
    } else {
        document.documentElement.removeAttribute("data-sub-theme");
    }
}

function renderSubscriptionRequestsQueue() {
    const requests = pendingSubscriptionRequests();
    if (!requests.length) {
        return `
            <h2 class="section-title">💎 Заявки на Bubbles+</h2>
            ${emptyState("💎", "Заявок нет", "Пока никто не оформлял подписку.")}
        `;
    }
    return `
        <h2 class="section-title">💎 Заявки на Bubbles+ (${requests.length})</h2>
        ${requests.map(subscriptionRequestRow).join("")}
    `;
}

function subscriptionRequestRow(request) {
    const user = getUser(request.userId);
    if (!user) return "";
    return `
        <div class="card" style="display:flex;flex-direction:column;gap:8px;">

            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <img loading="lazy" decoding="async"
                    class="mini-avatar"
                    src="${user.avatar || defaultAvatar()}"
                    onclick="navigate('profile','${user.id}')"
                    style="cursor:pointer"
                >
                <div style="flex:1;min-width:160px;">
                    <strong style="cursor:pointer" onclick="navigate('profile','${user.id}')">${escapeHtml(user.displayName)}</strong>
                    <div style="opacity:.7;font-size:13px;">
                        ${request.months} мес. · ${timeAgo(request.createdAt)}
                        ${isSubscriber(user) ? ` · уже 💎 Plus, ещё ${subscriptionDaysLeft(user)} дн.` : ""}
                    </div>
                </div>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="primary" onclick="approveSubscriptionRequest('${request.id}')">✅ Оплата пришла</button>
                <button class="secondary" onclick="declineSubscriptionRequest('${request.id}')">Отклонить</button>
            </div>

        </div>
    `;
}

async function approveSubscriptionRequest(requestId) {
    if (!isAdmin()) return;
    const request = db.subscriptionRequests.find(r => r.id === requestId);
    if (!request) return;
    const { error } = await sb.rpc("approve_subscription_request", { request_id: requestId });
    if (error) {
        console.error(error);
        toast("Не удалось подтвердить подписку.");
        return;
    }
    request.status = "approved";
    request.resolvedAt = Date.now();
    request.resolvedBy = currentUserId;
    const user = getUser(request.userId);
    if (user) {
        const base = isSubscriber(user) ? user.subscriptionExpiresAt : Date.now();
        user.subscriptionTier = "plus";
        user.subscriptionExpiresAt = base + request.months * 30 * 86400000;
    }
    toast("Подписка включена.");
    renderApp();
}

async function declineSubscriptionRequest(requestId) {
    if (!isAdmin()) return;
    const request = db.subscriptionRequests.find(r => r.id === requestId);
    if (!request) return;
    const { error } = await sb.from("subscription_requests")
        .update({ status: "declined", resolved_at: new Date().toISOString(), resolved_by: currentUserId })
        .eq("id", requestId);
    if (error) { console.error(error); toast("Не удалось отклонить заявку."); return; }
    request.status = "declined";
    toast("Заявка отклонена.");
    renderApp();
}

/* ============================================================
   SEARCH
   ============================================================ */

let userSearchQuery = "";
let searchTab = "users"; // "users" | "posts" | "music"
let selectedRoomId = null;
let roomMessagesChannel = null;

// A handful of preset themes so rooms can look visually distinct from
// each other while staying inside Bubbles' own palette — not arbitrary
// colors, just different combinations of the same Frutiger-Aero-ish
// gradient stops already used elsewhere (see .cover / body backgrounds).
const ROOM_THEMES = {
    aqua: "linear-gradient(135deg,#72dcff,#b8f5ff)",
    mint: "linear-gradient(135deg,#7ee5c9,#d3fff2)",
    pink: "linear-gradient(135deg,#ff9fd0,#ffe0f0)",
    lavender: "linear-gradient(135deg,#b39dff,#e3d8ff)",
    peach: "linear-gradient(135deg,#ff9868,#ffe0c9)"
};

let searchRenderDebounceTimer = null;

function searchUsers(value, sourceId){
    userSearchQuery = value;
    currentPage = "search";
    // The <input> already shows what's typed instantly (that's just the
    // browser) — only the expensive part (rebuilding the whole results
    // list, which fights for the keyboard focus, see below) gets
    // debounced, so fast typing doesn't re-render on every keystroke.
    clearTimeout(searchRenderDebounceTimer);
    searchRenderDebounceTimer = setTimeout(() => {
        const query = value.trim().toLowerCase();
        renderSearchResults(query);
        // renderSearchResults() rebuilds #page's innerHTML, which destroys and
        // recreates #searchPageInput as a brand-new (unfocused) DOM node every
        // time — on mobile that closes the keyboard. Re-focus + restore the
        // caret on whichever input the person is actually typing in.
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
    }, 150);
}

const SEARCH_TABS = [
    { id: "users", label: "👤 Люди" },
    { id: "posts", label: "📝 Посты" },
    { id: "music", label: "🎵 Музыка" },
    { id: "rooms", label: "🫧 Комнаты" }
];

function setSearchTab(tab) {
    searchTab = tab;
    renderSearchResults(userSearchQuery.trim().toLowerCase());
    replayPageTransition();
}

function renderSearchResults(query){
    // "@username" is how people actually type it, but usernames aren't
    // stored with the @ — strip it so that still matches instead of
    // silently returning nothing.
    const q = query.startsWith("@") ? query.slice(1) : query;

    const users = !q ? [] : db.users.filter(user =>
        user.id !== currentUserId &&
        (user.username.toLowerCase().includes(q) || user.displayName.toLowerCase().includes(q))
    );

    const posts = !q ? [] : [...db.posts]
        .filter(p => p.text && p.text.toLowerCase().includes(q))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 40); // a plain substring scan over every loaded post — fine at this scale, but capped so a very common word doesn't render dozens of full post cards at once

    const music = !q ? [] : db.music
        .filter(m => m.title.toLowerCase().includes(q) || m.artist.toLowerCase().includes(q))
        .slice(0, 40);

    const rooms = !q ? [] : db.rooms
        .filter(r => r.isPublic && (r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)))
        .slice(0, 40);

    const counts = { users: users.length, posts: posts.length, music: music.length, rooms: rooms.length };

    let resultsHtml;
    if (!q) {
        resultsHtml = emptyState("🔎", "Найди что-нибудь", "Ищи людей, посты по тексту или треки по названию/автору.");
    } else if (searchTab === "posts") {
        resultsHtml = posts.length ? posts.map(renderPost).join("") : emptyState("📝", "Постов не найдено", "Попробуй другой запрос.");
    } else if (searchTab === "music") {
        resultsHtml = music.length ? music.map(musicProfileCard).join("") : emptyState("🎵", "Треков не найдено", "Попробуй другое название или исполнителя.");
    } else if (searchTab === "rooms") {
        resultsHtml = rooms.length ? `<div class="rooms-grid">${rooms.map(roomCardHtml).join("")}</div>` : emptyState("🫧", "Комнат не найдено", "Попробуй другой запрос.");
    } else {
        resultsHtml = users.length
            ? `<div class="friend-grid">${users.map(friendCard).join("")}</div>`
            : emptyState("🔎", "Ничего не найдено", "Попробуй другой юзернейм или имя.");
    }

    document.getElementById("page").innerHTML = `

        <h1 class="section-title">
            🔎 Поиск
        </h1>

        <div class="user-search-box">
            <input
                id="searchPageInput"
                placeholder="Люди, посты, музыка..."
                value="${escapeHtml(userSearchQuery)}"
                oninput="searchUsers(this.value,'searchPageInput')"
            >
        </div>

        ${
            q
            ? `
                <div class="profile-tabs">
                    ${
                        SEARCH_TABS.map(t => `
                            <button type="button" class="profile-tab${searchTab === t.id ? " active" : ""}" onclick="setSearchTab('${t.id}')">
                                ${t.label}${counts[t.id] ? ` (${counts[t.id]})` : ""}
                            </button>
                        `).join("")
                    }
                </div>
            `
            : ""
        }

        ${resultsHtml}

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
        // visible_last_seen comes from the profiles_public view — it's
        // already null when this person turned show_online_status off
        // and it isn't your own row. Falls back to last_seen for the
        // rare direct-table read (e.g. your own profile) that doesn't
        // go through the view.
        lastSeen: (row.visible_last_seen !== undefined ? row.visible_last_seen : row.last_seen) || null,
        showOnlineStatus: row.show_online_status !== undefined ? !!row.show_online_status : true,
        wallVisibility: row.wall_visibility || "everyone",
        musicVisibility: row.music_visibility || "everyone",
        whoCanMessage: row.who_can_message || "everyone",
        whoCanFriendRequest: row.who_can_friend_request || "everyone",
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
        subscriptionTier: row.subscription_tier || "free",
        subscriptionExpiresAt: row.subscription_expires_at ? Date.parse(row.subscription_expires_at) : null,
        subscriptionFrame: row.subscription_frame || "none",
        subscriptionTheme: row.subscription_theme || "default",
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToPost(row) {
    return {
        id: row.id,
        authorId: row.author_id,
        wallOwnerId: row.wall_owner_id || row.author_id,
        text: row.text || "",
        image: row.image || "",
        musicId: row.music_id || null,
        sharedPostId: row.shared_post_id || null,
        likes: Array.isArray(row.likes) ? row.likes : [],
        reactions: [],
        pinned: !!row.pinned,
        pinnedAt: row.pinned_at ? Date.parse(row.pinned_at) : null,
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

function rowToCanvasItem(row) {
    return {
        id: row.id,
        ownerId: row.owner_id,
        type: row.type,
        content: row.content || "",
        color: row.color || "",
        x: Number(row.x ?? 50),
        y: Number(row.y ?? 50),
        rotation: Number(row.rotation ?? 0),
        scale: Number(row.scale ?? 1),
        zIndex: row.z_index ?? 0,
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

const CANVAS_BACKGROUNDS = {
    sky: "linear-gradient(160deg,#8be9ff,#c9f7ff 55%,#fdfff5)",
    candy: "linear-gradient(160deg,#ffb3e6,#c8b6ff 55%,#fff0fa)",
    sunset: "linear-gradient(160deg,#ffcf8f,#ff9fb0 55%,#fff2e6)",
    mint: "linear-gradient(160deg,#8ff5c9,#a9f0ff 55%,#f2fff9)",
    night: "linear-gradient(160deg,#2a2350,#4a3a7a 55%,#1a1633)"
};

// Everyone has exactly ONE room — themselves — so "opening a room" just
// means "load this person's canvas_rooms row + canvas_items". Nothing
// to join/leave/create the way the old group-chat rooms worked.
// Shown the instant someone taps into the room tab, before the
// fetch in openCanvasRoom() resolves — a rough silhouette of the real
// layout (toolbar + canvas) rather than a spinner, so it reads as
// "this is about to become the room" rather than a generic loading
// screen.
function renderCanvasRoomSkeleton() {
    const page = document.getElementById("page");
    if (!page) return;
    page.innerHTML = `
        <h1 class="section-title">🎨 Комната</h1>
        <div class="canvas-toolbar">
            ${Array.from({ length: 4 }).map(() => `<div class="skeleton" style="width:90px;height:38px;"></div>`).join("")}
        </div>
        <div class="skeleton" style="width:100%;aspect-ratio:3/4;border-radius:26px;"></div>
    `;
}

async function openCanvasRoom(userId) {
    selectedCanvasUserId = userId;
    canvasSelectedItemId = null;
    currentPage = "rooms";
    const [roomResult, itemsResult] = await Promise.all([
        sb.from("canvas_rooms").select("user_id,background").eq("user_id", userId).maybeSingle(),
        sb.from("canvas_items").select("*").eq("owner_id", userId).order("z_index", { ascending: true })
    ]);
    if (roomResult.error) console.error(roomResult.error);
    if (itemsResult.error) { console.error(itemsResult.error); toast("Не удалось загрузить комнату."); }
    canvasBackground = roomResult.data?.background || "sky";
    db.canvasItems = (itemsResult.data || []).map(rowToCanvasItem);
    renderRooms();
    playRoomTheme();
}

// The "theme song" for a room is whichever music sticker the owner has
// most recently brought to front (highest z-index) — with only one
// track placed, which is the common case, that's simply the one they
// added. Runs every time a room is freshly entered (see the
// isFreshEntryToRooms guard in navigate()), same as walking into
// someone's old Myspace profile and their song starts playing.
function playRoomTheme() {
    const musicItems = db.canvasItems.filter(it => it.type === "music" && it.content);
    if (!musicItems.length) return;
    const theme = musicItems.reduce((a, b) => (b.zIndex > a.zIndex ? b : a));
    playMusic(theme.content);
}

function isOwnCanvas() {
    return selectedCanvasUserId === currentUserId;
}

async function setCanvasBackground(bg) {
    if (!isOwnCanvas() || !CANVAS_BACKGROUNDS[bg]) return;
    canvasBackground = bg;
    const stage = document.getElementById("canvasStage");
    if (stage) stage.style.background = CANVAS_BACKGROUNDS[bg];
    const { error } = await sb.from("canvas_rooms")
        .upsert({ user_id: currentUserId, background: bg, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) console.error(error);
}

function nextCanvasZIndex() {
    return db.canvasItems.reduce((max, it) => Math.max(max, it.zIndex), 0) + 1;
}

async function addCanvasItem({ type, content, color = "" }) {
    if (!isOwnCanvas()) return;
    const item = {
        id: uid("canvasitem"),
        ownerId: currentUserId,
        type, content, color,
        x: 30 + Math.random() * 40,
        y: 30 + Math.random() * 40,
        rotation: Math.round((Math.random() * 16) - 8),
        scale: 1,
        zIndex: nextCanvasZIndex(),
        createdAt: Date.now()
    };
    db.canvasItems.push(item);
    renderRooms();
    const { error } = await sb.from("canvas_items").insert({
        id: item.id, owner_id: item.ownerId, type: item.type, content: item.content, color: item.color,
        x: item.x, y: item.y, rotation: item.rotation, scale: item.scale, z_index: item.zIndex
    });
    if (error) {
        console.error(error);
        db.canvasItems = db.canvasItems.filter(it => it.id !== item.id);
        toast("Не удалось добавить элемент.");
        renderRooms();
    }
}

function addCanvasText() {
    if (!isOwnCanvas()) return;
    const text = (prompt("Что напишем на стене? (до 120 символов)") || "").trim().slice(0, 120);
    if (!text) return;
    const colors = ["#ff6ec7", "#4fc9f5", "#7ee56d", "#ffce54", "#a78bfa"];
    const color = colors[Math.floor(Math.random() * colors.length)];
    addCanvasItem({ type: "text", content: text, color });
}

async function addCanvasImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !isOwnCanvas()) return;
    if (!file.type.startsWith("image/")) { toast("Можно загружать только изображения."); return; }
    if (file.size > 15 * 1024 * 1024) { toast("Файл слишком большой. Максимум 15 МБ."); return; }
    const type = file.type === "image/gif" ? "gif" : "image";
    toast("Загружаем…");
    try {
        const url = await uploadImageToStorage(file, `${currentUserId}/canvas-${uid("img")}.jpg`, 900);
        addCanvasItem({ type, content: url });
    } catch (e) {
        console.error(e);
        toast("Не удалось загрузить файл.");
    }
}

function openCanvasMusicPicker() {
    if (!isOwnCanvas()) return;
    openMusicPicker("canvas");
}

function toggleCanvasItemMusic(musicId) {
    playMusic(musicId);
}

// ------------------------------------------------------------
// GRAFFITI — a tiny full-screen freehand drawing tool. Draws on a
// transparent canvas so the result reads as "sprayed onto the wall"
// rather than a photo with a white box around it, then uploads the
// result as a normal image (type "doodle" is just for styling —
// no card/border behind it when placed).
// ------------------------------------------------------------
let graffitiCtx = null;
let graffitiDrawing = false;
let graffitiColor = "#ff2d78";
let graffitiSize = 10;

function openGraffitiTool() {
    if (!isOwnCanvas()) return;
    showBubblesModal(`
        <div class="modal-header">
            <h3>🖌️ Граффити</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        <canvas id="graffitiCanvas" class="graffiti-canvas" width="600" height="600"></canvas>
        <div class="graffiti-toolbar">
            ${["#ff2d78","#ff9f1c","#ffe066","#4fc9f5","#7ee56d","#a78bfa","#1a1a1a","#ffffff"].map(c => `
                <button type="button" class="graffiti-swatch" style="background:${c};" onclick="graffitiColor='${c}'"></button>
            `).join("")}
        </div>
        <div class="graffiti-toolbar">
            <button type="button" class="secondary" onclick="graffitiSize=6">Тонко</button>
            <button type="button" class="secondary" onclick="graffitiSize=14">Средне</button>
            <button type="button" class="secondary" onclick="graffitiSize=26">Жирно</button>
            <button type="button" class="secondary" onclick="clearGraffitiCanvas()">Стереть всё</button>
        </div>
        <button class="primary full" onclick="saveGraffiti()">Готово — повесить на стену</button>
    `);
    requestAnimationFrame(setupGraffitiCanvas);
}

function setupGraffitiCanvas() {
    const canvas = document.getElementById("graffitiCanvas");
    if (!canvas) return;
    graffitiCtx = canvas.getContext("2d");
    graffitiCtx.lineCap = "round";
    graffitiCtx.lineJoin = "round";

    const pos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    const start = (e) => {
        e.preventDefault();
        graffitiDrawing = true;
        const { x, y } = pos(e);
        graffitiCtx.beginPath();
        graffitiCtx.moveTo(x, y);
    };
    const draw = (e) => {
        if (!graffitiDrawing) return;
        e.preventDefault();
        const { x, y } = pos(e);
        graffitiCtx.strokeStyle = graffitiColor;
        graffitiCtx.lineWidth = graffitiSize;
        graffitiCtx.lineTo(x, y);
        graffitiCtx.stroke();
    };
    const stop = () => { graffitiDrawing = false; };

    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", draw);
    window.addEventListener("pointerup", stop);
}

function clearGraffitiCanvas() {
    const canvas = document.getElementById("graffitiCanvas");
    if (canvas && graffitiCtx) graffitiCtx.clearRect(0, 0, canvas.width, canvas.height);
}

async function saveGraffiti() {
    const canvas = document.getElementById("graffitiCanvas");
    if (!canvas) return;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) { toast("Пустой рисунок."); return; }
    closeBubblesModal();
    toast("Вешаем на стену…");
    const path = `${currentUserId}/canvas-${uid("doodle")}.png`;
    const { error: upErr } = await sb.storage.from(IMAGES_BUCKET).upload(path, blob, { contentType: "image/png", upsert: true });
    if (upErr) { console.error(upErr); toast("Не удалось сохранить рисунок."); return; }
    const url = sb.storage.from(IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
    addCanvasItem({ type: "doodle", content: url });
}

// ------------------------------------------------------------
// DRAG TO REPOSITION (owner only) — pointer-based so it works the same
// with touch and mouse. Position updates live while dragging for
// instant feedback; the DB write only happens once, on release.
// ------------------------------------------------------------
let canvasDragState = null;
let canvasSelectedItemId = null;

function startCanvasItemDrag(event, itemId) {
    if (!isOwnCanvas()) return;
    event.preventDefault();
    const stage = document.getElementById("canvasStage");
    const el = document.querySelector(`[data-canvas-item-id="${itemId}"]`);
    if (!stage || !el) return;
    // Deliberately NOT calling selectCanvasItem() here — it triggers a
    // full renderRooms() (rebuilds the whole canvas DOM), which would
    // instantly detach the very `stage`/`el` nodes just captured above,
    // before a single pointermove could ever reach them. That was the
    // actual bug: dragging silently did nothing because the listeners
    // below were being attached to elements already ripped out of the
    // document. Selection (if this turns out to be a tap, not a drag)
    // is handled once in onCanvasItemDragEnd instead, after we're done
    // touching the DOM ourselves.
    const stageRect = stage.getBoundingClientRect();
    canvasDragState = { itemId, el, stageRect, startX: event.clientX, startY: event.clientY, moved: false };
    el.setPointerCapture?.(event.pointerId);
    el.addEventListener("pointermove", onCanvasItemDragMove);
    el.addEventListener("pointerup", onCanvasItemDragEnd, { once: true });
}

function onCanvasItemDragMove(event) {
    if (!canvasDragState) return;
    const { stageRect, el, itemId, startX, startY } = canvasDragState;
    if (Math.abs(event.clientX - startX) > 3 || Math.abs(event.clientY - startY) > 3) canvasDragState.moved = true;
    const item = db.canvasItems.find(it => it.id === itemId);
    if (!item) return;
    let x = ((event.clientX - stageRect.left) / stageRect.width) * 100;
    let y = ((event.clientY - stageRect.top) / stageRect.height) * 100;
    x = Math.max(4, Math.min(96, x));
    y = Math.max(4, Math.min(96, y));
    item.x = x;
    item.y = y;
    el.style.left = x + "%";
    el.style.top = y + "%";
}

async function onCanvasItemDragEnd(event) {
    if (!canvasDragState) return;
    const { el, itemId, moved } = canvasDragState;
    el.removeEventListener("pointermove", onCanvasItemDragMove);
    canvasDragState = null;

    // No real movement — treat it as a plain tap: select the item to
    // show its little toolbar, same as before, just now the ONLY place
    // that happens (there used to also be a separate onclick on the
    // element itself, which combined with this could select-then-
    // immediately-deselect on every drag release).
    if (!moved) { selectCanvasItem(itemId); return; }

    const item = db.canvasItems.find(it => it.id === itemId);
    if (!item) return;
    const { error } = await sb.from("canvas_items").update({ x: item.x, y: item.y }).eq("id", itemId);
    if (error) console.error(error);
}

function selectCanvasItem(itemId) {
    canvasSelectedItemId = canvasSelectedItemId === itemId ? null : itemId;
    renderRooms();
}

async function bringCanvasItemToFront(itemId) {
    const item = db.canvasItems.find(it => it.id === itemId);
    if (!item || !isOwnCanvas()) return;
    item.zIndex = nextCanvasZIndex();
    renderRooms();
    const { error } = await sb.from("canvas_items").update({ z_index: item.zIndex }).eq("id", itemId);
    if (error) console.error(error);
}

async function rotateCanvasItem(itemId) {
    const item = db.canvasItems.find(it => it.id === itemId);
    if (!item || !isOwnCanvas()) return;
    item.rotation = (item.rotation + 15) % 360;
    renderRooms();
    const { error } = await sb.from("canvas_items").update({ rotation: item.rotation }).eq("id", itemId);
    if (error) console.error(error);
}

async function deleteCanvasItem(itemId) {
    if (!isOwnCanvas()) return;
    if (!confirm("Убрать этот элемент со стены?")) return;
    db.canvasItems = db.canvasItems.filter(it => it.id !== itemId);
    canvasSelectedItemId = null;
    renderRooms();
    const { error } = await sb.from("canvas_items").delete().eq("id", itemId);
    if (error) console.error(error);
}

function renderCanvasItem(item) {
    const selected = item.id === canvasSelectedItemId;
    const owner = isOwnCanvas();
    const baseStyle = `left:${item.x}%;top:${item.y}%;transform:translate(-50%,-50%) rotate(${item.rotation}deg) scale(${item.scale});z-index:${item.zIndex};`;
    const dragHandlers = owner
        ? `onpointerdown="startCanvasItemDrag(event,'${item.id}')"`
        : "";

    let inner = "";
    if (item.type === "text") {
        inner = `<div class="canvas-item-text" style="color:${item.color || "#333"};">${escapeHtml(item.content)}</div>`;
    } else if (item.type === "image" || item.type === "gif") {
        inner = `<div class="canvas-item-photo"><img loading="lazy" decoding="async" src="${item.content}"></div>`;
    } else if (item.type === "doodle") {
        inner = `<img loading="lazy" decoding="async" class="canvas-item-doodle" src="${item.content}">`;
    } else if (item.type === "music") {
        const track = db.music.find(m => m.id === item.content);
        inner = `
            <div class="canvas-item-music" onclick="${owner && selected ? "" : `toggleCanvasItemMusic('${item.content}')`}" title="${track ? escapeHtml(track.title) : "Трек удалён"}">
                💿
            </div>
        `;
    }

    return `
        <div class="canvas-item ${selected ? "canvas-item-selected" : ""}" data-canvas-item-id="${item.id}" style="${baseStyle}" ${dragHandlers}>
            ${inner}
            ${
                owner && selected
                ? `
                    <div class="canvas-item-toolbar">
                        <button type="button" onclick="event.stopPropagation();rotateCanvasItem('${item.id}')" title="Повернуть">↻</button>
                        <button type="button" onclick="event.stopPropagation();bringCanvasItemToFront('${item.id}')" title="Наверх">⬆️</button>
                        <button type="button" onclick="event.stopPropagation();deleteCanvasItem('${item.id}')" title="Удалить">🗑️</button>
                    </div>
                  `
                : ""
            }
        </div>
    `;
}

/* ============================================================
   GROUP ROOMS — public/private community chat spaces. Separate from
   renderRooms() below (the personal decorable canvas "Комната") despite
   the similar name in Russian; that one is unchanged.
   ============================================================ */

function roomMembersOf(roomId) {
    return db.roomMembers.filter(m => m.roomId === roomId);
}

function isRoomMember(roomId) {
    return db.roomMembers.some(m => m.roomId === roomId && m.userId === currentUserId);
}

function roomMemberRole(roomId) {
    return db.roomMembers.find(m => m.roomId === roomId && m.userId === currentUserId)?.role || null;
}

function roomOnlineCount(roomId) {
    return roomMembersOf(roomId).filter(m => isUserOnline(getUser(m.userId)?.lastSeen)).length;
}

function roomCardHtml(room) {
    return `
        <div class="room-card" onclick="navigate('roomChat','${room.id}')">
            <div class="room-card-icon" style="background:${ROOM_THEMES[room.theme] || ROOM_THEMES.aqua}">${room.icon}</div>
            <div class="room-card-main">
                <h3>${escapeHtml(room.name)} ${room.isPublic ? "" : "🔒"}</h3>
                <p>${escapeHtml(room.description || "Без описания")}</p>
                <div class="room-card-meta">${roomMembersOf(room.id).length} ${pluralPeople(roomMembersOf(room.id).length)} · 🟢 ${roomOnlineCount(room.id)} онлайн</div>
            </div>
        </div>
    `;
}

function renderGroupRoomsList() {
    const page = document.getElementById("page");
    const myRooms = db.rooms.filter(r => isRoomMember(r.id)).sort((a, b) => b.createdAt - a.createdAt);
    const otherPublicRooms = db.rooms.filter(r => r.isPublic && !isRoomMember(r.id)).sort((a, b) => b.createdAt - a.createdAt);

    page.innerHTML = `
        <div class="rooms-topbar">
            <h1 class="section-title" style="margin-bottom:0;">🫧 Комнаты</h1>
            <div class="rooms-header-actions">
                <button type="button" class="primary" onclick="openCreateRoomModal()">+ Создать</button>
            </div>
        </div>

        ${
            myRooms.length
            ? `<h3 class="rooms-subheading">Мои комнаты</h3><div class="rooms-grid">${myRooms.map(roomCardHtml).join("")}</div>`
            : ""
        }

        <h3 class="rooms-subheading">${myRooms.length ? "Другие публичные комнаты" : "Публичные комнаты"}</h3>
        ${
            otherPublicRooms.length
            ? `<div class="rooms-grid">${otherPublicRooms.map(roomCardHtml).join("")}</div>`
            : emptyState("🫧", "Комнат пока нет", "Создай первую — например, для музыки, игр или просто поболтать.")
        }
    `;
}

function openCreateRoomModal() {
    const themeSwatches = Object.keys(ROOM_THEMES).map(key => `
        <button type="button" class="room-theme-swatch${key === "aqua" ? " selected" : ""}" data-theme-key="${key}" style="background:${ROOM_THEMES[key]}" onclick="document.querySelectorAll('.room-theme-swatch').forEach(el=>el.classList.remove('selected'));this.classList.add('selected');"></button>
    `).join("");

    showBubblesModal(`
        <div class="modal-header">
            <h3>Новая комната</h3>
            <button class="modal-close-btn" onclick="closeBubblesModal()">✕</button>
        </div>
        <div class="room-create-form">
            <input id="newRoomIcon" maxlength="4" value="🫧" style="width:60px;text-align:center;font-size:22px;">
            <input id="newRoomName" maxlength="60" placeholder="Название комнаты">
            <textarea id="newRoomDescription" maxlength="200" placeholder="О чём эта комната?"></textarea>
            <div class="room-theme-picker">${themeSwatches}</div>
            <label class="room-public-toggle">
                <input id="newRoomIsPublic" type="checkbox" checked>
                Публичная — видна всем в списке комнат
            </label>
            <button type="button" class="primary full" onclick="submitCreateRoom()">Создать</button>
        </div>
    `);
}

async function submitCreateRoom() {
    const name = document.getElementById("newRoomName")?.value.trim();
    const description = document.getElementById("newRoomDescription")?.value.trim() || "";
    const icon = document.getElementById("newRoomIcon")?.value.trim() || "🫧";
    const isPublic = document.getElementById("newRoomIsPublic")?.checked ?? true;
    const theme = document.querySelector(".room-theme-swatch.selected")?.dataset.themeKey || "aqua";

    if (!name) { toast("Дай комнате название."); return; }

    const roomId = uid("room");
    const slug = name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/(^-|-$)/g, "") + "-" + roomId.slice(-6);

    const { error } = await sb.from("rooms").insert({
        id: roomId, name, slug, description, icon, theme, owner_id: currentUserId, is_public: isPublic
    });
    if (error) { console.error(error); toast("Не удалось создать комнату."); return; }

    const { error: memberError } = await sb.from("room_members").insert({
        room_id: roomId, user_id: currentUserId, role: "owner"
    });
    if (memberError) console.error(memberError);

    db.rooms.push({ id: roomId, name, slug, description, icon, theme, ownerId: currentUserId, isPublic, createdAt: Date.now() });
    db.roomMembers.push({ id: uid("rm"), roomId, userId: currentUserId, role: "owner", createdAt: Date.now() });

    closeBubblesModal();
    navigate("roomChat", roomId);
}

async function joinRoom(roomId) {
    if (isRoomMember(roomId)) return;
    db.roomMembers.push({ id: uid("rm"), roomId, userId: currentUserId, role: "member", createdAt: Date.now() });
    renderRoomChatHeader(roomId);
    const { error } = await sb.from("room_members").insert({ room_id: roomId, user_id: currentUserId, role: "member" });
    if (error) {
        console.error(error);
        db.roomMembers = db.roomMembers.filter(m => !(m.roomId === roomId && m.userId === currentUserId));
        renderRoomChatHeader(roomId);
        toast("Не удалось вступить в комнату.");
    }
}

async function leaveRoom(roomId) {
    const room = db.rooms.find(r => r.id === roomId);
    if (room && room.ownerId === currentUserId) {
        toast("Владелец не может покинуть свою комнату — удали её в настройках.");
        return;
    }
    const prevMembers = db.roomMembers;
    db.roomMembers = db.roomMembers.filter(m => !(m.roomId === roomId && m.userId === currentUserId));
    navigate("groupRooms");
    const { error } = await sb.from("room_members").delete().eq("room_id", roomId).eq("user_id", currentUserId);
    if (error) {
        console.error(error);
        db.roomMembers = prevMembers;
        toast("Не удалось покинуть комнату.");
    }
}

async function deleteRoom(roomId) {
    const room = db.rooms.find(r => r.id === roomId);
    if (!room || room.ownerId !== currentUserId) return;
    if (!confirm(`Удалить комнату «${room.name}» безвозвратно?`)) return;
    const { error } = await sb.from("rooms").delete().eq("id", roomId);
    if (error) { console.error(error); toast("Не удалось удалить комнату."); return; }
    db.rooms = db.rooms.filter(r => r.id !== roomId);
    db.roomMembers = db.roomMembers.filter(m => m.roomId !== roomId);
    navigate("groupRooms");
}

// Loads that room's message history once, on entry — not kept for every
// room the way DM conversations are, see the roomMessages comment in
// loadDB above.
async function openRoomChat(roomId) {
    selectedRoomId = roomId;
    if (!isRoomMember(roomId)) {
        const room = db.rooms.find(r => r.id === roomId);
        if (room && !room.isPublic) { toast("Эта комната приватная."); navigate("groupRooms"); return; }
    }
    const page = document.getElementById("page");
    page.innerHTML = `<div class="empty"><span class="loading-spinner"></span></div>`;

    const { data, error } = await sb
        .from("room_messages")
        .select("id,room_id,author_id,text,pinned,pinned_at,created_at")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(300);

    if (error) console.error(error);
    db.roomMessages = (data || []).map(row => ({
        id: row.id, roomId: row.room_id, authorId: row.author_id, text: row.text,
        pinned: !!row.pinned, pinnedAt: row.pinned_at ? Date.parse(row.pinned_at) : null,
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    }));

    renderRoomChat(roomId);
    joinRoomMessagesChannel(roomId);
}

function renderRoomChatHeader(roomId) {
    const el = document.getElementById("roomChatHeader");
    if (el) el.outerHTML = roomChatHeaderHtml(roomId);
}

function roomChatHeaderHtml(roomId) {
    const room = db.rooms.find(r => r.id === roomId);
    if (!room) return "";
    const member = isRoomMember(roomId);
    const isOwner = room.ownerId === currentUserId;
    return `
        <div id="roomChatHeader" class="room-chat-header" style="background:${ROOM_THEMES[room.theme] || ROOM_THEMES.aqua}">
            <button type="button" class="room-chat-back" onclick="navigate('groupRooms')">←</button>
            <div class="room-chat-icon">${room.icon}</div>
            <div class="room-chat-title">
                <h3>${escapeHtml(room.name)} ${room.isPublic ? "" : "🔒"}</h3>
                <small>${roomMembersOf(roomId).length} ${pluralPeople(roomMembersOf(roomId).length)} · 🟢 ${roomOnlineCount(roomId)} онлайн</small>
            </div>
            ${
                member
                ? `<button type="button" class="secondary" onclick="${isOwner ? `deleteRoom('${roomId}')` : `leaveRoom('${roomId}')`}">${isOwner ? "🗑" : "Выйти"}</button>`
                : `<button type="button" class="primary" onclick="joinRoom('${roomId}')">Вступить</button>`
            }
        </div>
    `;
}

function renderRoomChat(roomId) {
    const room = db.rooms.find(r => r.id === roomId);
    const page = document.getElementById("page");
    if (!room) { page.innerHTML = emptyState("🫧", "Комната не найдена", ""); return; }

    const member = isRoomMember(roomId);
    const messages = db.roomMessages.filter(m => m.roomId === roomId).sort((a, b) => a.createdAt - b.createdAt);
    const pinned = messages.filter(m => m.pinned);
    const canPin = ["owner", "moderator"].includes(roomMemberRole(roomId));

    const bubble = (m) => {
        const author = getUser(m.authorId);
        return `
            <div class="room-message${m.authorId === currentUserId ? " mine" : ""}">
                <img loading="lazy" decoding="async" class="mini-avatar" src="${author?.avatar || defaultAvatar()}" onclick="navigate('profile','${m.authorId}')">
                <div class="room-message-body">
                    <div class="room-message-meta">
                        <strong onclick="navigate('profile','${m.authorId}')">${escapeHtml(author?.displayName || "?")}</strong>
                        <small>${new Date(m.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</small>
                    </div>
                    <div class="room-message-bubble">${escapeHtml(m.text)}</div>
                    ${
                        canPin
                        ? `<button type="button" class="room-message-pin-btn" onclick="toggleRoomMessagePin('${m.id}')">${m.pinned ? "📌 Открепить" : "📌 Закрепить"}</button>`
                        : ""
                    }
                </div>
            </div>
        `;
    };

    page.innerHTML = `
        ${roomChatHeaderHtml(roomId)}

        <div class="card room-chat-card">

            ${
                pinned.length
                ? `
                    <div class="room-pinned-section">
                        <div class="room-pinned-label">📌 Закреплённые</div>
                        ${pinned.map(m => `<div class="room-pinned-item">${escapeHtml(m.text)}</div>`).join("")}
                    </div>
                `
                : ""
            }

            ${room.description ? `<p class="room-description">${escapeHtml(room.description)}</p>` : ""}

            <div id="roomMessagesList" class="room-chat-list">
                ${messages.length ? messages.map(bubble).join("") : emptyState("💬", "Тут пока тихо", "Напиши первое сообщение.")}
            </div>

            ${
                member
                ? `
                    <div class="room-composer">
                        <input id="roomMessageInput" placeholder="Сообщение..." onkeydown="if(event.key==='Enter')sendRoomMessage('${roomId}')">
                        <button type="button" class="primary" onclick="sendRoomMessage('${roomId}')">→</button>
                    </div>
                `
                : `<p class="wall-subtitle" style="text-align:center;">Вступи в комнату, чтобы писать сообщения.</p>`
            }

        </div>
    `;

    const list = document.getElementById("roomMessagesList");
    if (list) list.scrollTop = list.scrollHeight;
}

async function sendRoomMessage(roomId) {
    const input = document.getElementById("roomMessageInput");
    const text = input?.value.trim();
    if (!text) return;
    input.value = "";

    const tempId = uid("roommsg");
    const optimistic = { id: tempId, roomId, authorId: currentUserId, text, pinned: false, pinnedAt: null, createdAt: Date.now() };
    db.roomMessages.push(optimistic);
    renderRoomChat(roomId);

    const { data, error } = await sb.from("room_messages")
        .insert({ room_id: roomId, author_id: currentUserId, text })
        .select("id,created_at")
        .single();

    if (error) {
        console.error(error);
        db.roomMessages = db.roomMessages.filter(m => m.id !== tempId);
        renderRoomChat(roomId);
        toast("Сообщение не отправлено.");
        return;
    }
    // Swap the temp id for the real one so the later realtime INSERT
    // echo of this same row (see joinRoomMessagesChannel) is recognized
    // as a duplicate and skipped, instead of appearing twice.
    const msg = db.roomMessages.find(m => m.id === tempId);
    if (msg && data) { msg.id = data.id; msg.createdAt = Date.parse(data.created_at); }
}

async function toggleRoomMessagePin(messageId) {
    const m = db.roomMessages.find(x => x.id === messageId);
    if (!m) return;
    const wasPinned = m.pinned;
    m.pinned = !wasPinned;
    m.pinnedAt = m.pinned ? Date.now() : null;
    renderRoomChat(m.roomId);

    const { error } = await sb.from("room_messages")
        .update({ pinned: m.pinned, pinned_at: m.pinned ? new Date().toISOString() : null })
        .eq("id", messageId);

    if (error) {
        console.error(error);
        m.pinned = wasPinned;
        m.pinnedAt = wasPinned ? m.pinnedAt : null;
        renderRoomChat(m.roomId);
        toast("Не удалось закрепить сообщение.");
    }
}

// One channel for whichever room is currently open, same "tear down and
// rebuild on room switch" pattern as joinTypingChannel for DMs.
function joinRoomMessagesChannel(roomId) {
    if (roomMessagesChannel) { sb.removeChannel(roomMessagesChannel); roomMessagesChannel = null; }
    if (!roomId) return;
    roomMessagesChannel = sb.channel("bubbles-room-" + roomId)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` }, (payload) => {
            if (db.roomMessages.some(m => m.id === payload.new.id)) return; // our own optimistic echo
            db.roomMessages.push({
                id: payload.new.id, roomId: payload.new.room_id, authorId: payload.new.author_id,
                text: payload.new.text, pinned: !!payload.new.pinned,
                pinnedAt: payload.new.pinned_at ? Date.parse(payload.new.pinned_at) : null,
                createdAt: Date.parse(payload.new.created_at)
            });
            if (selectedRoomId === roomId) renderRoomChat(roomId);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` }, (payload) => {
            const m = db.roomMessages.find(x => x.id === payload.new.id);
            if (!m) return;
            m.pinned = !!payload.new.pinned;
            m.pinnedAt = payload.new.pinned_at ? Date.parse(payload.new.pinned_at) : null;
            if (selectedRoomId === roomId) renderRoomChat(roomId);
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` }, (payload) => {
            if (!db.roomMembers.some(m => m.roomId === roomId && m.userId === payload.new.user_id)) {
                db.roomMembers.push({ id: payload.new.id, roomId, userId: payload.new.user_id, role: payload.new.role || "member", createdAt: Date.now() });
            }
            if (selectedRoomId === roomId) renderRoomChatHeader(roomId);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` }, (payload) => {
            db.roomMembers = db.roomMembers.filter(m => !(m.roomId === roomId && m.userId === payload.old.user_id));
            if (selectedRoomId === roomId) renderRoomChatHeader(roomId);
        })
        .subscribe(logRealtimeStatus("room:" + roomId));
}

function renderRooms() {
    const page = document.getElementById("page");
    if (!selectedCanvasUserId) selectedCanvasUserId = currentUserId;
    if (db.canvasItems === undefined) db.canvasItems = [];
    const owner = getUser(selectedCanvasUserId);
    const mine = isOwnCanvas();

    page.innerHTML = `
        <div class="rooms-topbar">
            <div>
                <h1 class="section-title">🎨 ${mine ? "Твоя комната" : `Комната: ${escapeHtml(owner?.displayName || "")}`}</h1>
                <p class="room-description">${mine ? "Пустое полотно — вставляй что угодно и переставляй как хочешь." : "Гостевой просмотр — трогать может только хозяин(-ка)."}</p>
            </div>
            ${!mine ? `<button class="secondary" onclick="openCanvasRoom(currentUserId)">← Моя комната</button>` : ""}
        </div>

        ${
            mine
            ? `
                <div class="canvas-toolbar">
                    <button type="button" class="secondary" onclick="addCanvasText()">🔤 Текст</button>
                    <label class="secondary canvas-upload-btn">
                        🖼️ Фото/GIF
                        <input type="file" accept="image/*" onchange="addCanvasImage(event)" hidden>
                    </label>
                    <button type="button" class="secondary" onclick="openCanvasMusicPicker()">🎵 Музыка</button>
                    <button type="button" class="secondary" onclick="openGraffitiTool()">🖌️ Граффити</button>
                </div>
                <div class="canvas-bg-picker">
                    ${Object.keys(CANVAS_BACKGROUNDS).map(bg => `
                        <button type="button" class="canvas-bg-swatch ${bg === canvasBackground ? "active" : ""}" style="background:${CANVAS_BACKGROUNDS[bg]};" onclick="setCanvasBackground('${bg}')" title="${bg}"></button>
                    `).join("")}
                </div>
              `
            : ""
        }

        <div class="canvas-stage" id="canvasStage" style="background:${CANVAS_BACKGROUNDS[canvasBackground] || CANVAS_BACKGROUNDS.sky};" onclick="if(event.target.id==='canvasStage') canvasSelectedItemId=null, renderRooms()">
            ${
                db.canvasItems.length
                ? db.canvasItems.map(renderCanvasItem).join("")
                : `<div class="canvas-empty">${mine ? "Пока пусто — добавь первый элемент кнопками сверху 🫧" : "Здесь пока ничего нет."}</div>`
            }
        </div>
    `;
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

function rowToSubscriptionRequest(row) {
    return {
        id: row.id,
        userId: row.user_id,
        months: row.months,
        note: row.note || "",
        status: row.status || "pending",
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
        resolvedAt: row.resolved_at ? Date.parse(row.resolved_at) : null,
        resolvedBy: row.resolved_by || null
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
                text = decrypted === null ? "🔒 Сообщение недоступно (старое шифрование)" : decrypted;
            }
            if (image) {
                const decryptedImage = await BubblesCrypto.decryptString(sharedKey, image, row.img_iv);
                image = decryptedImage === null ? "" : decryptedImage;
            }
        } else {
            text = text ? "🔒 Сообщение недоступно (старое шифрование)" : "";
            image = "";
        }
    }

    return {

        id: row.id,

        from: row.sender_id,

        to: row.receiver_id,

        text,

        image,

        replyToId: row.reply_to_id || null,

        editedAt: row.edited_at ? Date.parse(row.edited_at) : null,
        pinned: !!row.pinned,
        pinnedAt: row.pinned_at ? Date.parse(row.pinned_at) : null,

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
// Accepts one id or an array of ids — badges now exist in two places
// (the desktop sidebar and the mobile bottom-nav/"Ещё" sheet), so most
// call sites need to update a pair of elements that show the same count.
function setNavBadge(ids, count) {
    (Array.isArray(ids) ? ids : [ids]).forEach(id => {
        const badge = document.getElementById(id);
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? "99+" : String(count);
            badge.classList.remove("hidden");
        } else {
            badge.textContent = "";
            badge.classList.add("hidden");
        }
    });
}

function updateNavBadges() {
    setNavBadge(["messagesUnreadBadge","messagesUnreadBadgeMobile"], getUnreadMessagesCount());
    setNavBadge(["friendRequestsBadge","friendRequestsBadgeMobile"], myIncomingRequests().length);
    setNavBadge("notifBadge", unreadNotificationsCount() + systemNotifications.filter(s => !s.read).length);
    // There's no separate "Admin" nav item any more — moderation lives on
    // your own profile page (see renderProfile), so this badge on
    // "Профиль" is the only hint an admin gets that reports OR pending
    // Bubbles+ requests are waiting — both queues live on that same page.
    setNavBadge(["pendingReportsBadge","pendingReportsBadgeMobile"], isAdmin() ? pendingReports().length + pendingSubscriptionRequests().length : 0);
    const petAttn = petNeedsAttention();
    setNavBadge(["petNeedsAttentionBadge","petNeedsAttentionBadgeMobile"], petAttn ? 1 : 0);
    // One combined dot on the "Ещё" bottom-nav button — otherwise a
    // badge tucked inside the overflow sheet is invisible until you
    // happen to open it.
    const moreDot = document.getElementById("moreSheetDot");
    if (moreDot) moreDot.classList.toggle("hidden", !petAttn);
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

async function loadDB() {
    try {
        const { data: { user } } = await sb.auth.getUser();
        currentUserId = user?.id || null;
        const [users, posts, comments, postLikes, commentLikes, friends, friendRequests, notifications, messages, messageReactions, music, musicSaves, postSaves, polls, pollOptions, pollVotes, follows, rooms, roomMembers, musicLikes, musicPlays, playlists, playlistTracks, reports, subscriptionRequests, blocks, stories, storyViews, storyReactions, petRow] = await Promise.all([
            sb.from("profiles_public").select("id,username,display_name,gender,avatar,cover,bio,visible_last_seen,current_track,current_artist,role,banned,ban_reason,public_key,unlocked_achievements,achievement_level,custom_status_title,custom_status_icon,subscription_tier,subscription_expires_at,subscription_frame,subscription_theme,created_at,show_online_status,wall_visibility,music_visibility,who_can_message,who_can_friend_request").order("created_at", { ascending: true }),
            sb.from("posts").select("id,author_id,wall_owner_id,text,image,music_id,shared_post_id,likes,pinned,pinned_at,created_at").order("created_at", { ascending: false }).limit(150),
            sb.from("comments").select("id,post_id,author_id,parent_comment_id,text,created_at").order("created_at", { ascending: true }).limit(1000),
            sb.from("post_likes").select("post_id,user_id,emoji").limit(20000),
            sb.from("comment_likes").select("comment_id,user_id").limit(20000),
            currentUserId ? sb.from("friendships").select("*") : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("friend_requests").select("*").eq("status", "pending") : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("bubbles_notifications").select("*").eq("user_id", currentUserId).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("messages").select("id,sender_id,receiver_id,text,image,created_at,read_at,encrypted,iv,img_iv,reply_to_id,edited_at,pinned,pinned_at").or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`).order("created_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("message_reactions").select("message_id,user_id,emoji") : Promise.resolve({ data: [], error: null }),
            sb.from("music").select("id,author_id,title,artist,cover_url,audio_url,audio_path,cover_path,created_at").order("created_at", { ascending: false }).limit(200),
            sb.from("music_saves").select("music_id,user_id").limit(10000),
            // RLS already restricts this to your own rows (see supabase.sql),
            // so this is naturally just your own bookmarks — nobody else's.
            currentUserId ? sb.from("post_saves").select("post_id").eq("user_id", currentUserId) : Promise.resolve({ data: [], error: null }),
            sb.from("polls").select("id,post_id,created_at").limit(500),
            sb.from("poll_options").select("id,poll_id,text,position").order("position", { ascending: true }),
            sb.from("poll_votes").select("poll_id,option_id,user_id").limit(20000),
            sb.from("follows").select("follower_id,followed_id").limit(20000),
            sb.from("rooms").select("id,name,slug,description,icon,theme,owner_id,is_public,created_at").limit(500),
            sb.from("room_members").select("id,room_id,user_id,role,created_at").limit(10000),
            sb.from("music_likes").select("music_id,user_id").limit(10000),
            currentUserId ? sb.from("music_plays").select("music_id,played_at").eq("user_id", currentUserId).order("played_at", { ascending: false }).limit(200) : Promise.resolve({ data: [], error: null }),
            sb.from("playlists").select("id,owner_id,name,created_at"),
            sb.from("playlist_tracks").select("id,playlist_id,music_id,position,added_at").limit(20000),
            // RLS only ever actually returns rows here for the reporter or an
            // admin, so this is cheap/empty for a regular user and only an
            // admin's own profile page ends up showing anything from it.
            currentUserId ? sb.from("reports").select("*").order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
            // Same RLS shape as reports just above: empty for a regular
            // user except their own requests, everything for an admin.
            currentUserId ? sb.from("subscription_requests").select("*").order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
            // RLS restricts this to blocker_id = you, so this is always just
            // your own block list — nobody else's, and nobody can see theirs.
            currentUserId ? sb.from("blocks").select("*") : Promise.resolve({ data: [], error: null }),
            // The select policy already excludes expired rows, so this is
            // just "everyone's currently-active stories".
            sb.from("stories").select("*").order("created_at", { ascending: true }),
            currentUserId ? sb.from("story_views").select("*") : Promise.resolve({ data: [], error: null }),
            // Same RLS shape as story_views: your own reactions, plus every
            // reaction on stories you authored.
            currentUserId ? sb.from("story_reactions").select("*") : Promise.resolve({ data: [], error: null }),
            // Canvas rooms are NOT loaded here — each one is fetched on
            // demand (see openCanvasRoom) only when someone actually opens
            // it, same reasoning as room_messages used to be.
            currentUserId ? sb.from("pets").select("*").eq("owner_id", currentUserId).maybeSingle() : Promise.resolve({ data: null, error: null })
        ]);
        const result = [users, posts, comments, postLikes, commentLikes, friends, friendRequests, notifications, messages, messageReactions, music, musicSaves, postSaves, polls, pollOptions, pollVotes, follows, rooms, roomMembers, musicLikes, musicPlays, playlists, playlistTracks, reports, subscriptionRequests, blocks, stories, storyViews, storyReactions, petRow];
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
            subscriptionRequests: (subscriptionRequests.data || []).map(rowToSubscriptionRequest),
            blocks: (blocks.data || []).map(row => ({ id: row.id, blockerId: row.blocker_id, blockedId: row.blocked_id })),
            stories: (stories.data || []).map(rowToStory),
            storyViews: (storyViews.data || []).map(row => ({ id: row.id, storyId: row.story_id, viewerId: row.viewer_id, viewedAt: row.viewed_at ? Date.parse(row.viewed_at) : Date.now() })),
            storyReactions: (storyReactions.data || []).map(row => ({ storyId: row.story_id, userId: row.user_id, emoji: row.emoji || "❤️", createdAt: row.created_at ? Date.parse(row.created_at) : Date.now() })),
            polls: (polls.data || []).map(row => ({ id: row.id, postId: row.post_id, createdAt: row.created_at ? Date.parse(row.created_at) : Date.now() })),
            pollOptions: (pollOptions.data || []).map(row => ({ id: row.id, pollId: row.poll_id, text: row.text, position: row.position || 0, votes: [] })),
            follows: (follows.data || []).map(row => ({ followerId: row.follower_id, followedId: row.followed_id })),
            rooms: (rooms.data || []).map(row => ({
                id: row.id, name: row.name, slug: row.slug, description: row.description || "",
                icon: row.icon || "🫧", theme: row.theme || "aqua", ownerId: row.owner_id,
                isPublic: !!row.is_public, createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
            })),
            roomMembers: (roomMembers.data || []).map(row => ({
                id: row.id, roomId: row.room_id, userId: row.user_id, role: row.role || "member",
                createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
            })),
            // Chat history for whichever room is currently open — loaded
            // on demand by openRoom(), not eagerly here, same reasoning
            // as canvasItems below: no point pulling every room's whole
            // history into memory for a list screen that only needs
            // member counts.
            roomMessages: [],
            playlists: (playlists.data || []).map(row => ({ id: row.id, ownerId: row.owner_id, name: row.name, createdAt: row.created_at ? Date.parse(row.created_at) : Date.now() })),
            playlistTracks: (playlistTracks.data || []).map(row => ({ id: row.id, playlistId: row.playlist_id, musicId: row.music_id, position: row.position || 0, addedAt: row.added_at ? Date.parse(row.added_at) : Date.now() })),
            canvasItems: [],
            pet: petRow.data ? rowToPet(petRow.data) : null
        };
        // Attach each track's likes from music_likes, same two-step
        // attach as post/comment/poll-option likes above.
        const musicLikesByTrack = new Map();
        (musicLikes.data || []).forEach(row => {
            if (!musicLikesByTrack.has(row.music_id)) musicLikesByTrack.set(row.music_id, []);
            musicLikesByTrack.get(row.music_id).push(row.user_id);
        });
        db.music.forEach(track => { track.likes = musicLikesByTrack.get(track.id) || []; });
        // Own listening history only (RLS already scopes music_plays to
        // this, see supabase.sql) — most-recent-first, deduped to one
        // entry per track for the "Недавно прослушанное" list.
        const seenTracks = new Set();
        myRecentPlays = [];
        (musicPlays.data || []).forEach(row => {
            if (seenTracks.has(row.music_id)) return;
            seenTracks.add(row.music_id);
            myRecentPlays.push({ musicId: row.music_id, playedAt: Date.parse(row.played_at) });
        });
        // Attach each poll option's votes from poll_votes, same
        // two-step attach as post/comment likes above.
        const votesByOption = new Map();
        (pollVotes.data || []).forEach(row => {
            if (!votesByOption.has(row.option_id)) votesByOption.set(row.option_id, []);
            votesByOption.get(row.option_id).push(row.user_id);
        });
        db.pollOptions.forEach(option => { option.votes = votesByOption.get(option.id) || []; });
        // Catches the pet up on however long the app was closed for
        // (see tickPet's comment for why this — not the 30s heartbeat —
        // is what applies the slower "away" decay rate), then starts
        // the heartbeat that ticks it at the normal rate while open.
        if (db.pet) await tickPet({ persist: true, awayCatchUp: true });
        // Ключ переписки (см. js/crypto.js) подтягивается лениво в
        // rowToMessage/sendMessage — тут больше не нужно ничего готовить
        // заранее и не нужно ничего спрашивать у человека.
        const orderedMessages = [...(messages.data || [])].reverse();
        db.messages = await Promise.all(orderedMessages.map(rowToMessage));

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
        mySavedPostIds = new Set((postSaves.data || []).map(row => row.post_id));

        // Attach each post's likes from the post_likes table (the source of
        // truth) rather than the old posts.likes jsonb column. post.likes
        // stays "everyone who reacted, any emoji" (achievements/old code
        // just count engagement); post.reactions carries the actual emoji
        // per person for the reaction bar, same shape as message.reactions.
        const likesByPost = new Map();
        const reactionsByPost = new Map();
        (postLikes.data || []).forEach(row => {
            if (!likesByPost.has(row.post_id)) likesByPost.set(row.post_id, []);
            likesByPost.get(row.post_id).push(row.user_id);
            if (!reactionsByPost.has(row.post_id)) reactionsByPost.set(row.post_id, []);
            reactionsByPost.get(row.post_id).push({ userId: row.user_id, emoji: row.emoji || "❤️" });
        });
        db.posts.forEach(post => {
            post.likes = likesByPost.get(post.id) || [];
            post.reactions = reactionsByPost.get(post.id) || [];
        });

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
        if(document.visibilityState !== "visible") return;
        const { data, error } = await sb.from("profiles_public").select("visible_last_seen").eq("id", userId).maybeSingle();
        if (error || !data) return;
        const user = getUser(userId);
        if (user) user.lastSeen = data.visible_last_seen;
        const el = document.getElementById("chatPartnerStatus");
        if (el) el.textContent = isUserOnline(data.visible_last_seen) ? "🟢 Онлайн" : "⚪ Не в сети";
    };
    refresh();
    chatPartnerPresenceTimer = setInterval(refresh, 30000);
}

function stopWatchingChatPartnerPresence() {
    if (chatPartnerPresenceTimer) {
        clearInterval(chatPartnerPresenceTimer);
        chatPartnerPresenceTimer = null;
    }
}

function setupMessagesRealtime() {
    removeChannelQuietly(messagesChannel, "messages");
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
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, async (payload) => {
            const row = payload.new;
            const local = db.messages.find(m => m.id === row.id);
            if (!local) return;
            local.readAt = row.read_at ? Date.parse(row.read_at) : null;
            const editedAt = row.edited_at ? Date.parse(row.edited_at) : null;
            const pinned = !!row.pinned;
            const metaChanged = local.editedAt !== editedAt || local.pinned !== pinned;

            if (!metaChanged) {
                if (local.from === currentUserId) {
                    const bubble = document.querySelector(`[data-bubbles-message-id="${local.id}"] .read-tick`);
                    if (bubble) {
                        bubble.textContent = local.readAt ? "✓✓" : "✓";
                        bubble.classList.toggle("read", !!local.readAt);
                    }
                }
                return;
            }

            local.editedAt = editedAt;
            local.pinned = pinned;
            local.pinnedAt = row.pinned_at ? Date.parse(row.pinned_at) : null;

            // Our own edit already has the right plaintext locally (set
            // optimistically in saveEditedMessage) — this echo is just
            // confirming it landed, nothing to re-decrypt. An edit from
            // the OTHER party arrives as ciphertext though, so that case
            // needs the same decrypt path rowToMessage already knows.
            if (local.from !== currentUserId && editedAt) {
                const decrypted = await rowToMessage(row);
                local.text = decrypted.text;
            }

            refreshMessageBubbleInPlace(local.id);
            const partnerId = local.from === currentUserId ? local.to : local.from;
            if (selectedChatId === partnerId) renderReplyPreviewBar();
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
            const row = payload.old;
            if (!db.messages.some(m => m.id === row.id)) return;
            db.messages = db.messages.filter(m => m.id !== row.id);
            document.querySelector(`[data-bubbles-message-id="${row.id}"]`)?.remove();
            const partnerId = row.sender_id === currentUserId ? row.receiver_id : row.sender_id;
            refreshConversationPreview(partnerId);
            updateNavBadges();
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
        .subscribe(logRealtimeStatus("messages"));
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
    removeChannelQuietly(notificationsChannel, "notifications");
    notificationsChannel = sb.channel("bubbles-notifications-" + currentUserId)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "bubbles_notifications" }, (payload) => {
            const row = payload.new;
            if (row.user_id !== currentUserId) return;
            if (db.notifications.some(n => n.id === row.id)) return;
            db.notifications.unshift(rowToNotification(row));
            updateNavBadges();
            // friend_request уже озвучивается своим каналом выше — не дублируем.
            if (row.type !== "friend_request") playSound("notification");
            // No toast here on purpose — friend requests, friend
            // acceptance, and new messages already announce themselves
            // via their own toast/popup elsewhere. This just keeps the
            // bell's badge and history in sync in the background.
            const panel = document.getElementById("notifPanel");
            if (panel && !panel.classList.contains("hidden")) panel.innerHTML = renderNotificationsPanel();
        })
        .subscribe(logRealtimeStatus("notifications"));
}

function setupFriendRequestsRealtime() {
    removeChannelQuietly(friendRequestsChannel, "friend-requests");
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
                playSound("friendRequest");
            }
            updateNavBadges();
            if (currentPage === "friends") renderFriends();
            if (currentPage === "profile") renderProfile(selectedProfileId || currentUserId);
        })
        .subscribe(logRealtimeStatus("friend-requests"));
}

function setupSocialRealtime() {
    removeChannelQuietly(socialChannel, "social");
    socialChannel = sb.channel("bubbles-social-" + currentUserId)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "post_likes" }, (payload) => {
            const post = db.posts.find(p => p.id === payload.new.post_id);
            if (!post) return;
            if (!post.reactions) post.reactions = [];
            if (!post.likes.includes(payload.new.user_id)) post.likes.push(payload.new.user_id);
            if (!post.reactions.some(r => r.userId === payload.new.user_id)) {
                post.reactions.push({ userId: payload.new.user_id, emoji: payload.new.emoji || "❤️" });
            }
            refreshPostInPlace(post.id);
        })
        // Fires when someone already reacted swaps their emoji — upsert()
        // hits this same-row UPDATE path, not INSERT, since (post_id,user_id)
        // is the primary key.
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "post_likes" }, (payload) => {
            const post = db.posts.find(p => p.id === payload.new.post_id);
            if (!post) return;
            if (!post.reactions) post.reactions = [];
            const mine = post.reactions.find(r => r.userId === payload.new.user_id);
            if (mine) mine.emoji = payload.new.emoji || "❤️";
            else post.reactions.push({ userId: payload.new.user_id, emoji: payload.new.emoji || "❤️" });
            refreshPostInPlace(post.id);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "post_likes" }, (payload) => {
            const post = db.posts.find(p => p.id === payload.old.post_id);
            if (!post) return;
            post.likes = post.likes.filter(id => id !== payload.old.user_id);
            if (post.reactions) post.reactions = post.reactions.filter(r => r.userId !== payload.old.user_id);
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
        // Poll votes — same INSERT/UPDATE/DELETE trio as post_likes above,
        // since poll_votes upserts on (poll_id,user_id) too (switching your
        // vote is an UPDATE, not a fresh INSERT).
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "poll_votes" }, (payload) => {
            const option = db.pollOptions.find(o => o.id === payload.new.option_id);
            if (!option) return;
            if (!option.votes.includes(payload.new.user_id)) option.votes.push(payload.new.user_id);
            const poll = db.polls.find(p => p.id === payload.new.poll_id);
            if (poll) refreshPostInPlace(poll.postId);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "poll_votes" }, (payload) => {
            const poll = db.polls.find(p => p.id === payload.new.poll_id);
            if (!poll) return;
            db.pollOptions
                .filter(o => o.pollId === payload.new.poll_id)
                .forEach(o => { o.votes = o.votes.filter(id => id !== payload.new.user_id); });
            const option = db.pollOptions.find(o => o.id === payload.new.option_id);
            if (option && !option.votes.includes(payload.new.user_id)) option.votes.push(payload.new.user_id);
            refreshPostInPlace(poll.postId);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "poll_votes" }, (payload) => {
            const poll = db.polls.find(p => p.id === payload.old.poll_id);
            const option = db.pollOptions.find(o => o.id === payload.old.option_id);
            if (option) option.votes = option.votes.filter(id => id !== payload.old.user_id);
            if (poll) refreshPostInPlace(poll.postId);
        })
        // Follows — purely local-state + a re-render if you're currently
        // looking at either side of the relationship; nothing on the
        // post/feed side needs to react to this.
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "follows" }, (payload) => {
            if (!db.follows.some(f => f.followerId === payload.new.follower_id && f.followedId === payload.new.followed_id)) {
                db.follows.push({ followerId: payload.new.follower_id, followedId: payload.new.followed_id });
            }
            const viewedId = selectedProfileId || currentUserId;
            if (currentPage === "profile" && (viewedId === payload.new.follower_id || viewedId === payload.new.followed_id)) {
                renderProfile(viewedId);
            }
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "follows" }, (payload) => {
            db.follows = db.follows.filter(f => !(f.followerId === payload.old.follower_id && f.followedId === payload.old.followed_id));
            const viewedId2 = selectedProfileId || currentUserId;
            if (currentPage === "profile" && (viewedId2 === payload.old.follower_id || viewedId2 === payload.old.followed_id)) {
                renderProfile(viewedId2);
            }
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, (payload) => {
            if (payload.new.author_id === currentUserId) return;
            if (db.posts.some(p => p.id === payload.new.id)) return;
            const post = rowToPost(payload.new);
            post.likes = [];
            post.reactions = [];
            justAddedPostId = post.id;
        db.posts.unshift(post);
        setTimeout(() => { if (justAddedPostId === post.id) justAddedPostId = null; }, 600);
            if (currentPage === "feed") renderFeed();
            else if (currentPage === "profile" && selectedProfileId && (post.wallOwnerId || post.authorId) === selectedProfileId) renderProfile(selectedProfileId);
        })
        .subscribe(logRealtimeStatus("social"));
}

function teardownRealtime() {
    removeChannelQuietly(messagesChannel, "messages");
    removeChannelQuietly(friendRequestsChannel, "friend-requests");
    removeChannelQuietly(notificationsChannel, "notifications");
    removeChannelQuietly(socialChannel, "social");
    removeChannelQuietly(roomMessagesChannel, "room");
    if (typingChannel) sb.removeChannel(typingChannel);
    messagesChannel = null;
    friendRequestsChannel = null;
    notificationsChannel = null;
    typingChannel = null;
    typingChannelPartnerId = null;
    socialChannel = null;
    roomMessagesChannel = null;
    selectedCanvasUserId = null;
    stopWatchingChatPartnerPresence();
}

/* ------------------------------------------------------------
   REALTIME WATCHDOG
   ------------------------------------------------------------
   None of the channel setup functions above ever got called a second
   time on their own — they only ran once, at login. That's the actual
   reason messages/likes/notifications "stop arriving in real time" and
   need a manual page refresh to come back: the underlying WebSocket
   drops constantly on a phone (screen locks, app goes to background,
   wifi hands off to cellular, the browser reclaims memory from a
   backgrounded tab) and, unlike a plain network request, nothing
   automatically retries a dead realtime subscription — it just stays
   silently disconnected until something explicitly reconnects it.

   This re-subscribes everything whenever the app plausibly needs it:
   coming back from the background, regaining a network connection, or
   restoring from iOS's back/forward cache (pageshow with persisted:true,
   which is how Safari resumes a Home Screen app instead of reloading
   it — none of Bubbles' own JS re-runs in that case, so nothing else
   would ever re-fire this). A trailing safety-net interval catches the
   rare cases where none of those events fire but the socket is dead
   anyway.
   ------------------------------------------------------------ */

let lastRealtimeReconnectAt = 0;

// Mobile browsers (iOS Safari especially, and anything running as a
// Home Screen PWA) aggressively suspend a page's WebSocket the moment
// it's backgrounded — switching to another app, locking the phone,
// even just switching tabs. reconnectRealtime() below re-subscribes
// the channels once the page is visible again, but a fresh
// subscription only delivers events from that moment forward — any
// message that arrived WHILE disconnected is simply gone as far as
// realtime is concerned. That's the actual cause of "have to refresh
// to see new messages": nothing is broken, the live channel is just
// blind to a gap it was never told about. This fetches anything
// newer than the newest message we already have and folds it in the
// same way a live INSERT would, so a reconnect catches up instead of
// silently staying stale until a full reload calls loadDB() again.
async function catchUpMessages() {
    if (!currentUserId) return;
    const newestKnown = db.messages.reduce((max, m) => Math.max(max, m.createdAt || 0), 0);
    try {
        const { data, error } = await sb.from("messages")
            .select("id,sender_id,receiver_id,text,image,created_at,read_at,encrypted,iv,img_iv,reply_to_id,edited_at,pinned,pinned_at")
            .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
            .gt("created_at", new Date(newestKnown || 0).toISOString())
            .order("created_at", { ascending: true });
        if (error || !data || !data.length) return;
        for (const row of data) {
            if (db.messages.some(m => m.id === row.id)) continue; // already have it (our own optimistic send, or a live event beat us here)
            const message = await rowToMessage(row);
            db.messages.push(message);
            if (message.from === currentUserId) continue; // sent from elsewhere under our own account — no popup needed
            if (currentPage === "messages" && selectedChatId === message.from) {
                appendMessageToChat(message, message.from);
                markChatAsRead(message.from);
            } else {
                if (currentPage === "messages") refreshConversationPreview(message.from);
                showNewMessagePopup(message);
            }
        }
        updateNavBadges();
    } catch (e) {
        console.error("catchUpMessages failed:", e);
    }
}

// Every .subscribe() call below used to fire blind — if a channel
// failed to actually connect (CHANNEL_ERROR, TIMED_OUT) or got closed
// server-side, nothing in the app would ever know: messages/likes/etc
// would just silently stop arriving live with zero indication of why,
// until a full reload rebuilt everything from scratch. This doesn't
// fix a connection problem by itself, but it turns an invisible
// failure into a visible one — check the console if realtime seems
// stuck again; it'll now say exactly which channel dropped and why,
// instead of just going quiet.
//
// reconnectRealtime() and teardownRealtime() both call removeChannel()
// on purpose (to rebuild a fresh channel, or on logout) — Supabase
// reports that as a "CLOSED" status just like an unexpected server-side
// drop would, so without this the console filled up with a fake ❌ for
// every single planned reconnect. removeChannelQuietly() marks the
// closure as expected so logRealtimeStatus can tell the two apart.
const expectedRealtimeCloses = new Set();

function removeChannelQuietly(channel, label) {
    if (!channel) return;
    expectedRealtimeCloses.add(label);
    sb.removeChannel(channel);
}

function logRealtimeStatus(label) {
    return (status, err) => {
        if (status === "SUBSCRIBED") { console.log(`✅ realtime: ${label}`); return; }
        if (status === "CLOSED" && expectedRealtimeCloses.has(label)) {
            expectedRealtimeCloses.delete(label);
            return; // we closed this one on purpose while reconnecting/logging out — not an error
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.error(`❌ realtime [${label}] ${status}`, err || "");
        }
    };
}

// Same reasoning as catchUpMessages above, for whichever room chat is
// currently open — its realtime channel is only (re)subscribed when
// reconnectRealtime() below decides to, same gap DMs had before
// catchUpMessages existed.
async function catchUpRoomMessages(roomId) {
    if (!roomId) return;
    const roomMsgs = db.roomMessages.filter(m => m.roomId === roomId);
    const newestKnown = roomMsgs.reduce((max, m) => Math.max(max, m.createdAt || 0), 0);
    try {
        const { data, error } = await sb.from("room_messages")
            .select("id,room_id,author_id,text,pinned,pinned_at,created_at")
            .eq("room_id", roomId)
            .gt("created_at", new Date(newestKnown || 0).toISOString())
            .order("created_at", { ascending: true });
        if (error || !data || !data.length) return;
        let added = false;
        for (const row of data) {
            if (db.roomMessages.some(m => m.id === row.id)) continue;
            db.roomMessages.push({
                id: row.id, roomId: row.room_id, authorId: row.author_id, text: row.text,
                pinned: !!row.pinned, pinnedAt: row.pinned_at ? Date.parse(row.pinned_at) : null,
                createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
            });
            added = true;
        }
        if (added && selectedRoomId === roomId) renderRoomChat(roomId);
    } catch (e) {
        console.error("catchUpRoomMessages failed:", e);
    }
}

function reconnectRealtime({ force = false } = {}) {
    if (!currentUserId || !sb?.realtime) return;

    // Debounce: visibilitychange, pageshow, and online can all fire
    // together within the same second (e.g. unlocking the phone while
    // it reconnects to wifi) — no need to tear down and rebuild every
    // channel more than once for that.
    const now = Date.now();
    if (!force && now - lastRealtimeReconnectAt < 3000) return;
    lastRealtimeReconnectAt = now;

    try {
        if (!sb.realtime.isConnected()) sb.realtime.connect();
    } catch (_) { /* best-effort — the setup calls below still rebuild the channels either way */ }

    setupMessagesRealtime();
    setupNotificationsRealtime();
    setupFriendRequestsRealtime();
    setupSocialRealtime();
    catchUpMessages(); // backfill anything sent while this tab was backgrounded/disconnected
    // Re-join the open chat's typing/presence channel too, if there is one —
    // joinTypingChannel() already no-ops if it's somehow still alive.
    if (typingChannelPartnerId) {
        const partnerId = typingChannelPartnerId;
        typingChannel = null; // force joinTypingChannel to actually rebuild it
        typingChannelPartnerId = null;
        joinTypingChannel(partnerId);
    }
    // Same idea for an open room chat's own channel + backlog.
    if (selectedRoomId && currentPage === "roomChat") {
        joinRoomMessagesChannel(selectedRoomId);
        catchUpRoomMessages(selectedRoomId);
    }
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        if (currentUserId) updateLastSeen();
        refreshOnlineCount();
        reconnectRealtime();
    }
});
window.addEventListener("online", () => reconnectRealtime());
// iOS Home Screen apps get suspended (not killed) in the background and
// resumed via "pageshow" with persisted:true instead of a fresh page
// load — this is the PWA equivalent of the tab-switch case above and is
// otherwise completely invisible to the rest of this file.
window.addEventListener("pageshow", (event) => {
    if (event.persisted) reconnectRealtime({ force: true });
});
// Safety net for the rare case none of the above fire but the socket
// died anyway: only acts when the page is visible and actually
// disconnected, so this is a no-op almost all the time.
setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (!currentUserId || !sb?.realtime) return;
    if (!sb.realtime.isConnected()) reconnectRealtime({ force: true });
}, 45000);

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

/* ------------------------------------------------------------
   Progress bar sync — one custom slim bar on the mini-player, a
   bigger one on the full-screen player, both driven off the same
   <audio> timeupdate/play/pause events so they never drift apart.
   ------------------------------------------------------------ */
function formatPlayerTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
}

(function setupPlayerProgress(){
    const audio = document.getElementById("globalAudio");
    if (!audio) return;

    const sync = () => {
        const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
        document.getElementById("globalPlayerProgressFill")?.style.setProperty("width", pct + "%");
        document.getElementById("fullPlayerProgressFill")?.style.setProperty("width", pct + "%");
        const curEl = document.getElementById("fullPlayerCurrentTime");
        const durEl = document.getElementById("fullPlayerDuration");
        if (curEl) curEl.textContent = formatPlayerTime(audio.currentTime);
        if (durEl) durEl.textContent = formatPlayerTime(audio.duration);
    };

    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("loadedmetadata", sync);
    audio.addEventListener("play", () => {
        const btn = document.getElementById("fullPlayerPlayPause");
        if (btn) btn.textContent = "⏸️";
    });
    audio.addEventListener("pause", () => {
        const btn = document.getElementById("fullPlayerPlayPause");
        if (btn) btn.textContent = "▶️";
    });
})();

// Shared by both progress bars (see their onclick in index.html) — works
// out the tapped fraction from the bar's own width rather than needing
// to know which of the two bars fired it.
function seekGlobalPlayer(event) {
    const audio = document.getElementById("globalAudio");
    if (!audio || !audio.duration) return;
    const bar = event.currentTarget;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = fraction * audio.duration;
}

function toggleGlobalPlayPause() {
    const audio = document.getElementById("globalAudio");
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    refreshMusicCardPlayState(audio.paused ? null : currentlyPlayingMusicId);
}

function openFullPlayer() {
    if (!currentlyPlayingMusicId) return;
    renderFullPlayer();
    document.getElementById("fullPlayer")?.classList.remove("hidden");
}

function closeFullPlayer() {
    document.getElementById("fullPlayer")?.classList.add("hidden");
}

function renderFullPlayer() {
    const music = db.music.find(m => m.id === currentlyPlayingMusicId);
    if (!music) return;
    const audio = document.getElementById("globalAudio");
    document.getElementById("fullPlayerCover").src = music.cover || defaultMusicCover();
    document.getElementById("fullPlayerTitle").textContent = music.title;
    document.getElementById("fullPlayerArtist").textContent = music.artist || "Unknown Artist";
    document.getElementById("fullPlayerPlayPause").textContent = audio && !audio.paused ? "⏸️" : "▶️";
    const liked = (music.likes || []).includes(currentUserId);
    const likeBtn = document.getElementById("fullPlayerLikeBtn");
    if (likeBtn) likeBtn.textContent = liked ? "❤️" : "🤍";
}

/* ------------------------------------------------------------
   MediaSession — это то, что рисует iOS/Android на экране
   блокировки и в шторке "сейчас играет": обложка, название,
   исполнитель, и кнопки play/pause/next/prev управляют плеером
   прямо оттуда, даже когда сайт свёрнут.
   ------------------------------------------------------------ */

function updateMediaSessionMetadata(music) {
    if (!("mediaSession" in navigator)) return;

    const cover = music.cover || defaultMusicCover();
    navigator.mediaSession.metadata = new MediaMetadata({
        title: music.title || "Без названия",
        artist: music.artist || "Unknown Artist",
        album: "Bubbles",
        artwork: [
            { src: cover, sizes: "96x96",   type: "image/png" },
            { src: cover, sizes: "192x192", type: "image/png" },
            { src: cover, sizes: "256x256", type: "image/png" },
            { src: cover, sizes: "384x384", type: "image/png" },
            { src: cover, sizes: "512x512", type: "image/png" }
        ]
    });
    navigator.mediaSession.playbackState = "playing";
}

(function setupMediaSession(){
    if (!("mediaSession" in navigator)) return;
    const audio = document.getElementById("globalAudio");
    if (!audio) return;

    navigator.mediaSession.setActionHandler("play", () => { audio.play().catch(() => {}); });
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => playPrevTrack());
    navigator.mediaSession.setActionHandler("nexttrack", () => playNextTrack());
    navigator.mediaSession.setActionHandler("stop", () => closeMusicPlayer());

    // Те самые "⟲10 / 10⟳" на экране блокировки, как на скрине.
    try {
        navigator.mediaSession.setActionHandler("seekbackward", (details) => {
            audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
        });
        navigator.mediaSession.setActionHandler("seekforward", (details) => {
            audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10));
        });
        navigator.mediaSession.setActionHandler("seekto", (details) => {
            if (details.seekTime != null) audio.currentTime = details.seekTime;
        });
    } catch (e) { /* не все браузеры поддерживают seek-обработчики */ }

    audio.addEventListener("play", () => { navigator.mediaSession.playbackState = "playing"; });
    audio.addEventListener("pause", () => { navigator.mediaSession.playbackState = "paused"; });

    // Ползунок прогресса на экране блокировки — обновляем при каждой смене трека и по ходу воспроизведения.
    const updatePosition = () => {
        if (!isFinite(audio.duration) || audio.duration <= 0) return;
        try {
            navigator.mediaSession.setPositionState({
                duration: audio.duration,
                playbackRate: audio.playbackRate || 1,
                position: Math.min(audio.currentTime, audio.duration)
            });
        } catch (e) {}
    };
    audio.addEventListener("loadedmetadata", updatePosition);
    audio.addEventListener("timeupdate", updatePosition);
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
    searchUsers,setSearchTab,createPost,toggleLike,toggleReaction,togglePostReactionPicker,toggleCommentLike,addComment,deleteComment,focusComment,openReplyBox,closeReplyBox,deletePost,
    saveProfile,onAvatarFileChosen,openChat,sendMessage,handleTyping,uploadMusic,playMusic,closeMusicPlayer,deleteMusic,
    toggleMessageReaction,toggleReactionPicker,
    startReplyToMessage,cancelReplyToMessage,scrollToMessage,
    startEditMessage,cancelEditMessage,deleteMessage,openForwardPicker,forwardMessageTo,toggleMessagePin,toggleChatSearch,setChatSearchQuery,jumpToMessageInChat,
    toggleNotificationsPanel,goToPost,setNotifFilterTab,markNotificationRead,markAllNotificationsRead,
    sendFriendRequest,cancelFriendRequest,declineFriendRequest,acceptFriendRequest,removeFriend,
    toggleFollow,openFollowListModal,
    setMusicTab,setMusicSearch,setMusicAutoplay,playNextTrack,playPrevTrack,toggleMusicSave,
    openFullPlayer,closeFullPlayer,seekGlobalPlayer,toggleGlobalPlayPause,renderFullPlayer,
    toggleMusicLike,openAddToPlaylistModal,createPlaylistAndAdd,addTrackToPlaylist,removeTrackFromPlaylist,deletePlaylist,playPlaylist,
    toggleProfileMusicExpanded,toggleProfileFriendsExpanded,toggleProfileAchievementsExpanded,
    setProfileTab,goToProfileMedia,shareProfile,
    toggleSavePost,renderSaved,
    openCreateRoomModal,submitCreateRoom,joinRoom,leaveRoom,deleteRoom,toggleRoomMessagePin,sendRoomMessage,
    setUserRole,setUserBanned,setCustomStatus,clearCustomStatus,backfillAchievementsForAllUsers,togglePinPost,
    toggleMoreSheet,openMoreSheet,closeMoreSheet,
    toggleSidebarMore,
    loadMoreFeedPosts,
    loadEarlierMessages,
    openCanvasRoom,setCanvasBackground,addCanvasText,addCanvasImage,openCanvasMusicPicker,toggleCanvasItemMusic,
    visitFriendsPet,feedFriendsPetAction,
    openGraffitiTool,clearGraffitiCanvas,saveGraffiti,
    startCanvasItemDrag,selectCanvasItem,bringCanvasItemToFront,rotateCanvasItem,deleteCanvasItem,
    reportPost,reportComment,reportProfile,dismissReport,moderateDeleteReportedContent,
    toggleBlockUser,
    openCreateSheet,openCreatePost,
    addStoryPrompt,openStoryViewer,closeStoryViewer,storyViewerAdvance,deleteCurrentStory,
    toggleStoryReaction,sendStoryReply,openStoryViewersModal,
    closeBubblesModal,
    openSharePicker,openShareToProfile,shareToProfile,openShareToChat,shareToChat,focusSharedPost,
    openMusicPicker,selectComposerMusic,removeComposerMusic,
    togglePollComposer,addPollOptionInput,voteInPoll,
    openEditPost,renderEditPostModal,handleEditPostImageSelect,removeEditPostImage,removeEditPostMusic,saveEditPost,syncEditPostTextFromDom,
    submitCreatePet,feedPet,playPet,cleanPet,toggleSleepPet
});
