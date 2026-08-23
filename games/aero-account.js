/* ============================================================
   Aero World — общий аккаунт с Bubbles
   ------------------------------------------------------------
   Использует тот же Supabase-проект, что и Bubbles: вход тут — это
   вход в тот же самый аккаунт (тот же логин/пароль, тот же профиль).

   Важный нюанс: Aero World и Bubbles живут на РАЗНЫХ доменах
   (zeshpr.github.io и alayseerasen.github.io), а браузер не делится
   localStorage/сессией между разными доменами — это его встроенная
   защита приватности, обойти её нельзя. Поэтому автоматически "увидеть"
   вход из Bubbles на Aero World не получится — тут отдельный вход,
   просто той же учёткой. Зато между СТРАНИЦАМИ САМОГО Aero World
   (bubbling.html, mini-games, все игры) сессия расшаривается сама
   собой, потому что они все на одном домене.
   ============================================================ */
(function () {
    const SUPABASE_URL = "https://vmrsnlujwsqgfuyzqbyp.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_R3olby66_wqY0FN0pXs__Q_lnZjWQoI";
    const BUBBLES_URL = "https://alayseerasen.github.io/bubbles/";

    if (!window.supabase) {
        console.error("aero-account.js: подключи https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 ДО этого скрипта.");
        return;
    }

    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.aeroSupabase = sb;

    function el(tag, attrs, ...children) {
        const e = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (k === "class") e.className = v;
            else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
            else e.setAttribute(k, v);
        });
        children.forEach(c => { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
        return e;
    }

    async function getProfile(userId) {
        const { data, error } = await sb.from("profiles").select("display_name,username,avatar").eq("id", userId).single();
        if (error) { console.error(error); return null; }
        return data;
    }

    function buildLoginForm(host) {
        const wrap = el("div", { class: "aero-account-login" });
        const email = el("input", { type: "email", placeholder: "email от Bubbles", class: "aero-account-input", autocomplete: "email" });
        const password = el("input", { type: "password", placeholder: "пароль", class: "aero-account-input", autocomplete: "current-password" });
        const msg = el("div", { class: "aero-account-msg" });
        const submit = el("button", {
            class: "aero-account-submit",
            onclick: async () => {
                if (!email.value.trim() || !password.value) { msg.textContent = "Заполни оба поля."; return; }
                submit.disabled = true;
                msg.textContent = "Входим…";
                const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
                submit.disabled = false;
                if (error) { msg.textContent = "Не тот email или пароль."; return; }
                renderWidget(host);
            }
        }, "Войти");
        [email, password].forEach(input => input.addEventListener("keydown", e => { if (e.key === "Enter") submit.click(); }));
        const toggle = el("button", { class: "aero-account-toggle", onclick: () => { collapsed = !collapsed; renderWidget(host); } }, "✕");
        wrap.append(
            el("div", { class: "aero-account-title" }, "🫧 Тот же аккаунт, что в Bubbles", toggle),
            email, password, submit, msg
        );
        return wrap;
    }

    function buildLoggedInBadge(host, profile, userId) {
        const name = profile?.display_name || profile?.username || "Bubbler";
        const avatar = profile
            ? el("img", { src: profile.avatar || "", class: "aero-account-avatar" })
            : el("div", { class: "aero-account-avatar aero-account-avatar-fallback" }, "🫧");
        if (!profile?.avatar) { avatar.className += " aero-account-avatar-fallback"; avatar.textContent = "🫧"; if (avatar.tagName === "IMG") avatar.removeAttribute("src"); }
        return el("div", { class: "aero-account-badge" },
            avatar,
            el("span", { class: "aero-account-name" }, name),
            el("a", { href: BUBBLES_URL, class: "aero-account-link", target: "_blank", rel: "noopener" }, "Bubbles →"),
            el("button", {
                class: "aero-account-logout",
                onclick: async () => { await sb.auth.signOut(); renderWidget(host); }
            }, "Выйти")
        );
    }

    function buildCollapsedButton(host) {
        return el("button", {
            class: "aero-account-mini",
            onclick: () => { collapsed = false; renderWidget(host); }
        }, "🫧");
    }

    let collapsed = false;

    async function renderWidget(host) {
        host = host || document.getElementById("aeroAccountWidget");
        if (!host) return;
        host.innerHTML = "";

        if (collapsed) { host.appendChild(buildCollapsedButton(host)); return; }

        const { data: { session } } = await sb.auth.getSession();
        if (!session) { host.appendChild(buildLoginForm(host)); return; }

        const profile = await getProfile(session.user.id);
        host.appendChild(buildLoggedInBadge(host, profile, session.user.id));
    }

    function init() {
        renderWidget();
        sb.auth.onAuthStateChange(() => renderWidget());
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
