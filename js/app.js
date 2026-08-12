/* ============================================================
   BUBBLES
   Local prototype social network
   ============================================================ */

const MAX_MUSIC_SIZE = 15 * 1024 * 1024;
const MAX_COVER_SIZE = 5 * 1024 * 1024;
const MUSIC_BUCKET = "music";

const sb = window.bubblesSupabase;

let db = {
    users: [],
    posts: [],
    comments: [],
    friends: [],
    friendRequests: [],
    messages: [],
    music: []
};

let currentUserId = null;
let currentPage = "feed";
let selectedProfileId = null;
let selectedChatId = null;
let genderValue = "female";
let currentlyPlayingMusicId = null;
let heartbeatTimer = null;

/* Music player state */
let musicTab = "mine";           // "mine" | "all"
let musicSearchQuery = "";
let musicQueue = [];             // ids, in the order currently shown
let musicAutoplay = true;

/* Messenger state */
let typingChannel = null;
let typingIndicatorTimer = null;
let messagesChannel = null;
let friendRequestsChannel = null;
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

function toast(text) {
    const container = document.getElementById("toastContainer");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => {
        el.remove();
    }, 3000);
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload =
            e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
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

/* ============================================================
   AUTH
   ============================================================ */

function showAuth(mode = "login") {
    document.getElementById("app").innerHTML = `
        <div class="auth-screen">
            <div class="auth-box">
                <div class="logo">bubbles</div>
                <div class="logo-sub">маленькая социальная сеть с большим количеством пузырьков</div>
                ${mode === "login" ? loginForm() : registerForm()}
            </div>
        </div>
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
        await ensureProfile(data.user);
        currentUserId = data.user.id;
        await loadDB();
        startApp();
    }
    catch (error) {
        console.error(error);
        toast("Аккаунт создан, но профиль не удалось создать.");
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
        await ensureProfile(data.user);
        currentUserId = data.user.id;
        await loadDB();
        startApp();
    }
    catch (error) {
        console.error(error);
        toast("Не удалось загрузить профиль.");
    }
}

async function logout(){
    stopPresenceHeartbeat();
    teardownRealtime();
    closeMusicPlayer();
    await sb.auth.signOut();
    currentUserId = null;
    db = {users:[],posts:[],comments:[],friends:[],friendRequests:[],messages:[],music:[]};
    showAuth("login");
}

/* ============================================================
   MAIN APP
   ============================================================ */

function startApp(){
    if(!getCurrentUser()){
        logout();
        return;
    }
    startPresenceHeartbeat();
    setupMessagesRealtime();
    setupFriendRequestsRealtime();
    setupSocialRealtime();
    renderApp();
}

function renderApp(){
    const user = getCurrentUser();

    document.getElementById("app").innerHTML = `

        <header class="topbar">

            <div
                class="top-logo"
                onclick="navigate('feed')"
                style="cursor:pointer"
            >
                bubbles
            </div>


            <div class="search">

                <input
                    id="searchInput"
                    placeholder="Поиск пользователей..."
                    oninput="searchUsers(this.value)"
                >

            </div>


            <div class="top-user">

                <img
                    class="mini-avatar"
                    src="${user.avatar || defaultAvatar()}"
                >

                <span>
                    ${escapeHtml(user.displayName)}
                </span>

            </div>

        </header>


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
                        onclick="location.href='https://zeshpr.github.io/frutigeraeropage/bubbling.html'"
                    >
                        🫧 На главную
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

    document.querySelectorAll(".nav-btn[data-page]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === page);
    });

    switch(page){
        case "feed": renderFeed(); break;
        case "profile": renderProfile(id || currentUserId); break;
        case "friends": renderFriends(); break;
        case "messages": renderMessages(); break;
        case "music": renderMusic(); break;
        case "edit": renderEditProfile(); break;
        case "search": renderSearchResults(id || ""); break;
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
                    class="primary"
                    onclick="createPost()"
                >
                    Опубликовать
                </button>

            </div>

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
}

function renderPost(post){
    const author = getUser(post.authorId);
    if(!author) return "";
    const liked = post.likes?.includes(currentUserId);
    const comments = db.comments.filter(c => c.postId === post.id).sort((a,b) => a.createdAt - b.createdAt);

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

                    <small>
                        @${escapeHtml(author.username)}
                        · ${timeAgo(post.createdAt)}
                    </small>

                </div>

            </div>


            ${
                post.text
                ? `
                    <div class="post-content">
                        ${escapeHtml(post.text)}
                    </div>
                `
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
                    onclick="sharePost('${post.id}')"
                >
                    ↗ Поделиться
                </button>


                ${
                    post.authorId === currentUserId
                    ? `
                        <button
                            class="action-btn"
                            onclick="deletePost('${post.id}')"
                        >
                            🗑️
                        </button>
                    `
                    : ""
                }

            </div>


            <div class="comment-list">

                ${
                    comments
                    .map(comment => {

                        const user =
                            getUser(comment.authorId);

                        return `
                            <div class="comment">

                                <strong>
                                    ${escapeHtml(
                                        user?.displayName ||
                                        "Пользователь"
                                    )}
                                </strong>

                                ${escapeHtml(comment.text)}

                            </div>
                        `;

                    })
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
    if (!text && !file) {
        toast("Добавь текст или изображение.");
        return;
    }
    let image = "";
    if (file) {
        if (!file.type.startsWith("image/")) {
            toast("Можно загружать только изображения.");
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            toast("Изображение слишком большое. Максимум 8 МБ.");
            return;
        }
        image = await fileToDataURL(file);
    }
    const post = { id: uid("post"), authorId: currentUserId, text, image, likes: [], createdAt: Date.now() };
    db.posts.unshift(post);
    const { error } = await sb.from("posts").insert({
        id: post.id, author_id: post.authorId, text: post.text, image: post.image, likes: [], created_at: new Date(post.createdAt).toISOString()
    });
    if (error) {
        db.posts = db.posts.filter(p => p.id !== post.id);
        console.error(error);
        toast("Не удалось опубликовать пост.");
        return;
    }
    toast("Пост опубликован!");
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
    // moment, the live posts subscription (setupSocialRealtime) reconciles
    // it a moment later, so this stays correct without feeling slow.
    const wasLiked = post.likes.includes(currentUserId);
    const likesArray = wasLiked
        ? post.likes.filter(id => id !== currentUserId)
        : [...post.likes, currentUserId];

    post.likes = likesArray;
    refreshPostInPlace(postId);

    const { error } = await sb.from("posts").update({ likes: likesArray }).eq("id", postId);
    if (error) {
        console.error(error);
        // roll back on failure
        post.likes = wasLiked ? [...likesArray, currentUserId] : likesArray.filter(id => id !== currentUserId);
        refreshPostInPlace(postId);
        toast("Не удалось поставить лайк.");
    }
}

async function addComment(postId) {
    const input = document.getElementById("comment-" + postId);
    if (!input)
        return;
    const text = input.value.trim();
    if (!text)
        return;
    input.value = "";
    const comment = { id: uid("comment"), postId, authorId: currentUserId, text, createdAt: Date.now() };
    db.comments.push(comment);
    refreshPostInPlace(postId);

    const { error } = await sb.from("comments").insert({
        id: comment.id, post_id: comment.postId, author_id: comment.authorId, text: comment.text, created_at: new Date(comment.createdAt).toISOString()
    });
    if (error) {
        db.comments = db.comments.filter(c => c.id !== comment.id);
        console.error(error);
        toast("Не удалось добавить комментарий.");
        refreshPostInPlace(postId);
        return;
    }
}

function focusComment(postId){
    const input = document.getElementById("comment-" + postId);
    if(input){
        input.focus();
        input.scrollIntoView({behavior:"smooth",block:"center"});
    }
}

async function sharePost(postId){
    const post = db.posts.find(p => p.id === postId);
    if(!post) return;
    const author = getUser(post.authorId);
    const text = `Пост ${author?.displayName || ""} в bubbles`;
    if(navigator.share){
        try{ await navigator.share({title:"bubbles",text}); }catch{}
    }else{
        try{
            await navigator.clipboard.writeText(location.href);
            toast("Ссылка скопирована.");
        }catch{
            toast("Не удалось скопировать ссылку.");
        }
    }
}

async function deletePost(postId) {
    const post = db.posts.find(p => p.id === postId);
    if (!post || post.authorId !== currentUserId)
        return;
    if (!confirm("Удалить пост?"))
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

function renderProfile(userId){
    const user = getUser(userId);
    if(!user){ navigate("feed"); return; }
    const posts = db.posts.filter(p => p.authorId === user.id).sort((a,b) => b.createdAt - a.createdAt);
    const friends = db.friends.filter(f => f.user1 === user.id || f.user2 === user.id);
    const music = db.music.filter(m => m.authorId === user.id);
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
                            `
                        }

                    </div>

                </div>


                ${
                    user.bio
                    ? `
                        <div class="bio">
                            ${escapeHtml(user.bio)}
                        </div>
                    `
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


        <h2 class="section-title">
            🎵 Музыка
        </h2>


        ${
            music.length
            ? music.map(musicProfileCard).join("")
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
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById("editAvatarPreview").src = e.target.result;
    };
    reader.readAsDataURL(file);
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
        if (avatarFile.size > 5 * 1024 * 1024) {
            toast("Аватар слишком большой. Максимум 5 МБ.");
            return;
        }
        user.avatar = await fileToDataURL(avatarFile);
    }
    if (coverFile) {
        if (coverFile.size > 8 * 1024 * 1024) {
            toast("Обложка слишком большая. Максимум 8 МБ.");
            return;
        }
        user.cover = await fileToDataURL(coverFile);
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
   MESSAGES
   ============================================================ */

function openChat(userId) {
    selectedChatId = userId;
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


    renderMessages();


    console.log(
        "👁️ Прочитано:",
        messageIds.length
    );

}
function renderMessages(){
    const friends = db.friends.filter(f => f.user1 === currentUserId || f.user2 === currentUserId);
    const users = friends.map(f => getUser(f.user1 === currentUserId ? f.user2 : f.user1)).filter(Boolean);
    if(!selectedChatId && users.length) selectedChatId = users[0].id;

    document.getElementById("page").innerHTML = `

        <h1 class="section-title">
            💬 Сообщения
        </h1>


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
                            ? escapeHtml(
                                lastMessage.text ||
                                ""
                            )
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

        <form
            class="chat-input"
            onsubmit="sendMessage(event,'${userId}')"
        >

            <input
    id="messageInput"
    maxlength="1000"
    autocomplete="off"
    placeholder="Написать сообщение..."
    oninput="handleTyping()"
    required
>

            <button class="primary">
                Отправить
            </button>

        </form>

    `;
}

function messageBubble(message){
    const mine = message.from === currentUserId;
    return `

        <div class="message ${mine ? "me" : "them"}" data-bubbles-message-id="${message.id}">

            ${escapeHtml(message.text)}

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

        </div>

    `;

}

/* ------------------------------------------------------------
   TYPING INDICATOR (Supabase Realtime broadcast — no DB table)
   ------------------------------------------------------------ */

let typingTimer = null;

function chatChannelName(userId) {
    return "bubbles-chat-" + [currentUserId, userId].sort().join("-");
}

function joinTypingChannel(partnerId) {
    if (typingChannel) { sb.removeChannel(typingChannel); typingChannel = null; }
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
        message.text ||
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
        const empty = box.querySelector(".empty");
        if (empty) empty.remove();
        const wrapper = document.createElement("div");
        wrapper.innerHTML = messageBubble(message).trim();
        box.appendChild(wrapper.firstElementChild);
        box.scrollTop = box.scrollHeight;
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

async function sendMessage(event, userId) {
    event.preventDefault();
    stopTyping();
    const input = document.getElementById("messageInput");
    const text = input.value.trim();
    if (!text)
        return;
    input.value = "";
    const message = { id: uid("message"), from: currentUserId, to: userId, text, createdAt: Date.now(), readAt: null };
    db.messages.push(message);
    appendMessageToChat(message, userId);

    const { error } = await sb.from("messages").insert({ id: message.id, sender_id: message.from, receiver_id: message.to, text: message.text, created_at: new Date(message.createdAt).toISOString() });
    if (error) {
        console.error(error);
        db.messages = db.messages.filter(m => m.id !== message.id);
        toast("Не удалось отправить сообщение.");
        const bubble = document.querySelector(`[data-bubbles-message-id="${message.id}"]`);
        if (bubble) bubble.remove();
        return;
    }
}

/* ============================================================
   MUSIC
   ============================================================ */

// The list currently shown in the Music tab, given the active tab + search —
// this is also the "queue" that next/prev/autoplay walks through.
function getFilteredMusicList() {
    let list = [...db.music];
    if (musicTab === "mine") list = list.filter(m => m.authorId === currentUserId);
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
                    <div class="form-group"><label>Имя артиста</label><input id="musicArtist" maxlength="80" placeholder="Например, VASILISA HEELS"></div>
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
            : emptyState("🎵", musicTab === "mine" ? "Ты ещё не публиковал(а) музыку" : "Ничего не найдено", musicTab === "mine" ? "Загрузи свой первый трек выше." : "Попробуй другой запрос.")
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
                ${music.authorId === currentUserId ? `<button onclick="deleteMusic('${music.id}')" title="Удалить">🗑️</button>` : ""}
            </div>
        </div>
    `;
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
    if (!music || music.authorId !== currentUserId)
        return;
    if (!confirm("Удалить этот трек?"))
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
   SEARCH
   ============================================================ */

function searchUsers(value){
    const query = value.trim().toLowerCase();
    if(!query){
        if(currentPage === "search") navigate("feed");
        return;
    }
    currentPage = "search";
    renderSearchResults(query);
}

function renderSearchResults(query){
    const users = db.users.filter(user => user.id !== currentUserId && (user.username.toLowerCase().includes(query) || user.displayName.toLowerCase().includes(query)));

    document.getElementById("page").innerHTML = `

        <h1 class="section-title">
            🔎 Результаты поиска
        </h1>


        ${
            users.length
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
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToPost(row) {
    return {
        id: row.id,
        authorId: row.author_id,
        text: row.text || "",
        image: row.image || "",
        likes: Array.isArray(row.likes) ? row.likes : [],
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToComment(row) {
    return {
        id: row.id,
        postId: row.post_id,
        authorId: row.author_id,
        text: row.text || "",
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

function rowToFriendRequest(row) {
    return {
        id: row.id,
        fromUser: row.from_user,
        toUser: row.to_user,
        status: row.status || "pending",
        createdAt: row.created_at ? Date.parse(row.created_at) : Date.now()
    };
}

function rowToMessage(row) {

    return {

        id: row.id,

        from: row.sender_id,

        to: row.receiver_id,

        text: row.text || "",

        createdAt:
            row.created_at
                ? Date.parse(row.created_at)
                : Date.now(),

        readAt:
            row.read_at
                ? Date.parse(row.read_at)
                : null

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
        const [users, posts, comments, friends, friendRequests, messages, music] = await Promise.all([
            sb.from("profiles").select("*").order("created_at", { ascending: true }),
            sb.from("posts").select("*").order("created_at", { ascending: false }),
            sb.from("comments").select("*").order("created_at", { ascending: true }),
            currentUserId ? sb.from("friendships").select("*") : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("friend_requests").select("*").eq("status", "pending") : Promise.resolve({ data: [], error: null }),
            currentUserId ? sb.from("messages").select("*").order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
            sb.from("music").select("*").order("created_at", { ascending: false })
        ]);
        const result = [users, posts, comments, friends, friendRequests, messages, music];
        const bad = result.find(x => x?.error);
        if (bad?.error)
            throw bad.error;
        db = {
            users: (users.data || []).map(rowToUser),
            posts: (posts.data || []).map(rowToPost),
            comments: (comments.data || []).map(rowToComment),
            friends: (friends.data || []).map(rowToFriend),
            friendRequests: (friendRequests.data || []).map(rowToFriendRequest),
            messages: (messages.data || []).map(rowToMessage),
            music: (music.data || []).map(rowToMusic)
        };
    }
    catch (error) {
        console.error("Supabase load error:", error);
        toast("Не удалось загрузить данные из Supabase.");
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
            likes: p.likes || [],
            created_at: new Date(p.createdAt || Date.now()).toISOString()
        }));
        const comments = db.comments.map(c => ({
            id: c.id,
            post_id: c.postId,
            author_id: c.authorId,
            text: c.text || "",
            created_at: new Date(c.createdAt || Date.now()).toISOString()
        }));
        const friends = db.friends.map(f => ({
            id: f.id,
            user1: f.user1,
            user2: f.user2,
            created_at: new Date(f.createdAt || Date.now()).toISOString()
        }));
        const messages = db.messages.map(m => ({
            id: m.id,
            sender_id: m.from,
            receiver_id: m.to,
            text: m.text || "",
            created_at: new Date(m.createdAt || Date.now()).toISOString()
        }));
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
            messages.length ? sb.from("messages").upsert(messages) : null,
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
        avatar: defaultAvatar(),
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
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
            const row = payload.new;
            if (row.sender_id !== currentUserId && row.receiver_id !== currentUserId) return;
            if (row.sender_id === currentUserId) return; // I already added it optimistically
            const message = rowToMessage(row);
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
    sb.channel("bubbles-social-" + currentUserId)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "posts" }, (payload) => {
            const post = db.posts.find(p => p.id === payload.new.id);
            if (!post || post.authorId === undefined) return;
            post.likes = Array.isArray(payload.new.likes) ? payload.new.likes : post.likes;
            refreshPostInPlace(post.id);
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments" }, (payload) => {
            if (db.comments.some(c => c.id === payload.new.id)) return; // already added optimistically
            if (payload.new.author_id === currentUserId) return;
            db.comments.push(rowToComment(payload.new));
            refreshPostInPlace(payload.new.post_id);
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, (payload) => {
            if (payload.new.author_id === currentUserId) return;
            if (db.posts.some(p => p.id === payload.new.id)) return;
            db.posts.unshift(rowToPost(payload.new));
            if (currentPage === "feed") renderFeed();
        })
        .subscribe();
}

function teardownRealtime() {
    [messagesChannel, friendRequestsChannel, typingChannel].forEach(ch => { if (ch) sb.removeChannel(ch); });
    messagesChannel = null;
    friendRequestsChannel = null;
    typingChannel = null;
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
        if(currentUserId) await ensureProfile(session.user);
        await loadDB();
        if(currentUserId && getCurrentUser()) startApp();
        else showAuth("login");
    }catch(error){
        console.error("Bubbles init error:",error);
        showAuth("login");
        toast("Проверь Supabase URL и ключ в js/supabase-config.js");
    }
})();

sb.auth.onAuthStateChange(async (_event,session)=>{
    if(session?.user){
        currentUserId=session.user.id;
        try{ await ensureProfile(session.user); await loadDB(); startApp(); }catch(error){console.error(error);}
    }else if(_event==="SIGNED_OUT"){
        currentUserId=null;
    }
});

/* Functions used by the existing inline HTML handlers. */
Object.assign(window,{
    showAuth,loginForm,registerForm,selectGender,register,login,logout,
    navigate,renderFeed,renderProfile,renderFriends,renderMessages,renderMusic,renderEditProfile,
    searchUsers,createPost,toggleLike,addComment,focusComment,sharePost,deletePost,
    saveProfile,previewAvatar,openChat,sendMessage,handleTyping,uploadMusic,playMusic,closeMusicPlayer,deleteMusic,
    sendFriendRequest,cancelFriendRequest,declineFriendRequest,acceptFriendRequest,removeFriend,
    setMusicTab,setMusicSearch,setMusicAutoplay,playNextTrack,playPrevTrack
});
