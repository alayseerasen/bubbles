/* ============================================================
   BUBBLES — Telegram account linking
   ------------------------------------------------------------
   Frontend half of connecting a Bubbles account to a Telegram chat.
   The actual code generation happens server-side, in the
   create_telegram_link_token() Postgres function (security definer,
   always uses auth.uid() — a person can never request a code "for"
   someone else). Verifying "/link CODE" or "/start CODE" and creating
   the real link happens entirely in the separate telegram-bot/
   service (see repo root), using the service role key — this file
   never has, and never needs, any elevated access. All it does is:
   ask for a code, show it, poll telegram_links (readable only for
   your own row under RLS) until the bot has done its part, and let
   you disconnect your own row.
   ============================================================ */

// Holds the code currently shown on screen while waiting for the
// person to send it to the bot. Cleared once linked, once it expires,
// or when leaving the settings page.
let telegramLinkPending = null; // { code, expiresAt }
let telegramLinkPollTimer = null;

function stopTelegramLinkPolling() {
    if (telegramLinkPollTimer) {
        clearInterval(telegramLinkPollTimer);
        telegramLinkPollTimer = null;
    }
}

function startTelegramLinkPolling() {
    stopTelegramLinkPolling();
    telegramLinkPollTimer = setInterval(async () => {
        if (!telegramLinkPending) { stopTelegramLinkPolling(); return; }

        if (Date.now() > telegramLinkPending.expiresAt) {
            telegramLinkPending = null;
            stopTelegramLinkPolling();
            if (currentPage === "edit") renderEditProfile();
            return;
        }

        try {
            const { data } = await sb.from("telegram_links").select("id").eq("user_id", currentUserId).maybeSingle();
            if (data) {
                telegramLinkPending = null;
                stopTelegramLinkPolling();
                toast("✅ Telegram подключён!");
                if (currentPage === "edit") renderEditProfile();
            }
        } catch (e) {
            // Transient network hiccup — just try again on the next tick.
            console.error("telegram link poll failed:", e);
        }
    }, 3000);
}

// Renders the "🔔 Telegram-уведомления" card for the settings page,
// in whichever of its three states applies right now. Called from
// renderEditProfile() in app.js.
async function renderTelegramSettingsSection() {
    if (!currentUserId) return "";

    let link = null;
    try {
        const { data, error } = await sb.from("telegram_links")
            .select("telegram_username, enabled")
            .eq("user_id", currentUserId)
            .maybeSingle();
        if (error) throw error;
        link = data;
    } catch (e) {
        console.error("failed to load telegram link status:", e);
    }

    const botUsername = window.BUBBLES_TELEGRAM_BOT_USERNAME || "";
    const botLink = botUsername ? `https://t.me/${botUsername}` : "";
    if (link) {
        return `
            <div class="card" style="margin-bottom:16px;">
                <strong>🔔 Telegram-уведомления</strong>
                <div style="margin:10px 0;color:var(--green2);font-weight:700;">
                    🟢 Telegram подключён${link.telegram_username ? ` — @${escapeHtml(link.telegram_username)}` : ""}
                </div>
                <p class="muted" style="font-size:13px;margin-bottom:12px;">
                    Уведомления Bubbles дублируются в Telegram. Какие именно — сообщения, лайки, комментарии, заявки в друзья — настраивается командой /settings прямо в боте.
                </p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="secondary" type="button" onclick="telegramSettingsPlaceholder()">⚙️ Настройки уведомлений</button>
                    <button class="secondary" type="button" onclick="relinkTelegram()">🔁 Подключить другой Telegram</button>
                    <button class="secondary" type="button" style="color:#e5544f;" onclick="disconnectTelegram()">🔕 Отключить Telegram</button>
                </div>
            </div>
        `;
    }

    if (telegramLinkPending && Date.now() <= telegramLinkPending.expiresAt) {
        const code = telegramLinkPending.code;
        const secondsLeft = Math.max(0, Math.round((telegramLinkPending.expiresAt - Date.now()) / 1000));
        const minutesLeft = Math.max(1, Math.ceil(secondsLeft / 60));
        const deepLink = botLink ? `${botLink}?start=${encodeURIComponent(code)}` : "";
        return `
            <div class="card" style="margin-bottom:16px;">
                <strong>🔔 Telegram-уведомления</strong>
                <p class="muted" style="margin:10px 0 6px;">Ваш код подключения:</p>
                <div class="telegram-code-box" onclick="copyTelegramCode('${code}')" title="Нажмите, чтобы скопировать">${code}</div>
                <p class="muted" style="margin:12px 0 6px;">
                    ${botUsername ? `Нажмите «Открыть бота» ниже — код подставится сам, либо откройте <a href="${botLink}" target="_blank" rel="noopener">@${escapeHtml(botUsername)}</a> вручную` : "Откройте Telegram-бота Bubbles Notifications"} и отправьте команду:
                </p>
                <div class="telegram-code-box telegram-code-command">/link ${code}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
                    <button class="secondary" type="button" onclick="copyTelegramCode('${code}')">📋 Скопировать код</button>
                    ${deepLink ? `<button class="secondary" type="button" onclick="window.open('${deepLink}','_blank')">✈️ Открыть бота</button>` : ""}
                    <button class="secondary" type="button" onclick="generateTelegramCode(event)">🔄 Новый код</button>
                </div>
                <p class="muted" style="font-size:12px;margin-top:10px;">
                    Код действует ещё ~${minutesLeft} мин и работает только один раз. Ждём подтверждения от бота…
                </p>
            </div>
        `;
    }

    return `
        <div class="card" style="margin-bottom:16px;">
            <strong>🔔 Telegram</strong>
            <p class="muted" style="margin:8px 0 12px;">Получайте уведомления Bubbles прямо в Telegram.</p>
            <button class="primary" type="button" onclick="generateTelegramCode(event)">Подключить Telegram</button>
        </div>
    `;
}

async function generateTelegramCode(event) {
    const button = event?.target;
    const originalText = button ? button.textContent : null;
    if (button) { button.disabled = true; button.textContent = "Генерируем…"; }

    try {
        const { data, error } = await sb.rpc("create_telegram_link_token");
        if (error) throw error;

        telegramLinkPending = { code: data, expiresAt: Date.now() + 10 * 60 * 1000 };
        startTelegramLinkPolling();
        if (currentPage === "edit") renderEditProfile();
    } catch (e) {
        console.error("failed to generate telegram link code:", e);
        toast("Не удалось сгенерировать код. Попробуйте ещё раз.");
        if (button) { button.disabled = false; button.textContent = originalText; }
    }
}

// "Уже подключён к другому Telegram" flow: generating a fresh code is
// harmless (the old link stays active until someone actually sends
// /link with the new code to a NEW chat, at which point the bot
// replaces the old row) — so this just warns what's about to happen
// and then reuses the normal generate flow.
async function relinkTelegram() {
    const ok = confirm("Если вы отправите новый код из другого Telegram-аккаунта, текущая привязка будет заменена. Продолжить?");
    if (!ok) return;
    await generateTelegramCode();
}

async function disconnectTelegram() {
    const ok = confirm("Отключить Telegram-уведомления?");
    if (!ok) return;

    try {
        const { error } = await sb.from("telegram_links").delete().eq("user_id", currentUserId);
        if (error) throw error;
        toast("🔕 Telegram отключён от Bubbles.");
        if (currentPage === "edit") renderEditProfile();
    } catch (e) {
        console.error("failed to disconnect telegram:", e);
        toast("Не удалось отключить Telegram. Попробуйте ещё раз.");
    }
}

function telegramSettingsPlaceholder() {
    toast("Настройте типы уведомлений прямо в Telegram-боте командой /settings.");
}

async function copyTelegramCode(code) {
    try {
        await navigator.clipboard.writeText(code);
        toast("📋 Код скопирован");
    } catch (e) {
        // Clipboard API needs a secure context / permission; fall back
        // to a manual select-and-copy prompt so the code is never
        // stuck unreachable on an older or locked-down browser.
        window.prompt("Скопируйте код вручную:", code);
    }
}
