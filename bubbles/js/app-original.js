/* ============================================================
   BUBBLES
   Local prototype social network
   ============================================================ */

const DB_KEY = "bubbles_social_database_v7";
const SESSION_KEY = "bubbles_current_user_v7";

const MAX_MUSIC_SIZE = 15 * 1024 * 1024;

let db = {
    users: [],
    posts: [],
    comments: [],
    friends: [],
    messages: [],
    music: []
};

let currentUserId = localStorage.getItem(SESSION_KEY) || null;
let currentPage = "feed";
let selectedProfileId = null;
let selectedChatId = null;
let genderValue = "female";

let musicDB = null;
let globalAudioURL = null;
let currentlyPlayingMusicId = null;


/* ============================================================
   INDEXED DB
   ============================================================ */

function openMusicDB(){

    return new Promise((resolve,reject)=>{

        const request = indexedDB.open(
            "bubbles_music_storage",
            1
        );

        request.onupgradeneeded = event => {

            const database = event.target.result;

            if(!database.objectStoreNames.contains("tracks")){

                database.createObjectStore("tracks",{
                    keyPath:"id"
                });

            }

        };

        request.onsuccess = event => {

            musicDB = event.target.result;

            resolve(musicDB);

        };

        request.onerror = () => {
            reject(request.error);
        };

    });

}


function saveAudioFile(id,file){

    return new Promise((resolve,reject)=>{

        const tx = musicDB.transaction(
            "tracks",
            "readwrite"
        );

        tx.objectStore("tracks").put({
            id:id,
            blob:file
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);

    });

}


function getAudioFile(id){

    return new Promise((resolve,reject)=>{

        const tx = musicDB.transaction(
            "tracks",
            "readonly"
        );

        const request =
            tx.objectStore("tracks").get(id);

        request.onsuccess = () => {

            resolve(
                request.result
                ? request.result.blob
                : null
            );

        };

        request.onerror = () => {
            reject(request.error);
        };

    });

}


function deleteAudioFile(id){

    return new Promise((resolve,reject)=>{

        const tx = musicDB.transaction(
            "tracks",
            "readwrite"
        );

        tx.objectStore("tracks").delete(id);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);

    });

}


/* ============================================================
   DATABASE
   ============================================================ */

function loadDB(){

    try{

        const saved =
            localStorage.getItem(DB_KEY);

        if(saved){

            const parsed = JSON.parse(saved);

            db = {
                users:parsed.users || [],
                posts:parsed.posts || [],
                comments:parsed.comments || [],
                friends:parsed.friends || [],
                messages:parsed.messages || [],
                music:parsed.music || []
            };

        }

    }catch(error){

        console.error(error);

    }

}


function saveDB(){

    try{

        localStorage.setItem(
            DB_KEY,
            JSON.stringify(db)
        );

    }catch(error){

        console.error(error);

        toast(
            "Локальное хранилище переполнено. Музыка теперь хранится отдельно."
        );

    }

}


/* ============================================================
   HELPERS
   ============================================================ */

function uid(prefix="id"){

    return prefix +
        "_" +
        Date.now().toString(36) +
        "_" +
        Math.random()
        .toString(36)
        .slice(2,8);

}


function escapeHtml(value){

    return String(value ?? "")
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;")
        .replaceAll('"',"&quot;")
        .replaceAll("'","&#039;");

}


function getUser(id){

    return db.users.find(
        user => user.id === id
    );

}


function getCurrentUser(){

    return getUser(currentUserId);

}


function isFriend(userId){

    return db.friends.some(
        f =>
            (f.user1 === currentUserId && f.user2 === userId) ||
            (f.user2 === currentUserId && f.user1 === userId)
    );

}


function defaultAvatar(){

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


function defaultMusicCover(){

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


function timeAgo(timestamp){

    const diff =
        Date.now() - timestamp;

    const sec =
        Math.floor(diff / 1000);

    if(sec < 60)
        return "только что";

    const min =
        Math.floor(sec / 60);

    if(min < 60)
        return min + " мин.";

    const hours =
        Math.floor(min / 60);

    if(hours < 24)
        return hours + " ч.";

    const days =
        Math.floor(hours / 24);

    if(days < 30)
        return days + " д.";

    return new Date(timestamp)
        .toLocaleDateString("ru-RU");

}


function toast(text){

    const container =
        document.getElementById("toastContainer");

    const el =
        document.createElement("div");

    el.className = "toast";

    el.textContent = text;

    container.appendChild(el);

    setTimeout(()=>{
        el.remove();
    },3000);

}


function fileToDataURL(file){

    return new Promise((resolve,reject)=>{

        const reader =
            new FileReader();

        reader.onload =
            e => resolve(e.target.result);

        reader.onerror = reject;

        reader.readAsDataURL(file);

    });

}


function emptyState(icon,title,text){

    return `
        <div class="card empty">
            <div class="empty-icon">${icon}</div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(text)}</p>
        </div>
    `;

}


/* ============================================================
   AUTH
   ============================================================ */

function showAuth(mode="login"){

    document.getElementById("app").innerHTML = `

        <div class="auth-screen">

            <div class="auth-box">

                <div class="logo">bubbles</div>

                <div class="logo-sub">
                    маленькая социальная сеть с большим количеством пузырьков
                </div>


                ${
                    mode === "login"
                    ? loginForm()
                    : registerForm()
                }

            </div>

        </div>
    `;

}


function loginForm(){

    return `

        <form onsubmit="login(event)">

            <div class="form-group">
                <label>Юзернейм</label>
                <input
                    id="loginUsername"
                    autocomplete="username"
                    required
                    placeholder="например bubbles_user"
                >
            </div>


            <div class="form-group">
                <label>Пароль</label>
                <input
                    id="loginPassword"
                    type="password"
                    autocomplete="current-password"
                    required
                    placeholder="••••••••"
                >
            </div>


            <button class="primary full">
                Войти в bubbles
            </button>

        </form>


        <div class="auth-switch">

            Нет аккаунта?

            <button onclick="showAuth('register')">
                Создать аккаунт
            </button>

        </div>

    `;

}


function registerForm(){

    return `

        <form onsubmit="register(event)">

            <div class="form-group">

                <label>Юзернейм</label>

                <input
                    id="registerUsername"
                    required
                    minlength="3"
                    maxlength="25"
                    pattern="[A-Za-z0-9_.-]+"
                    placeholder="например bubbles_user"
                >

            </div>


            <div class="form-group">

                <label>Имя</label>

                <input
                    id="registerName"
                    required
                    maxlength="40"
                    placeholder="Как тебя будут видеть"
                >

            </div>


            <div class="form-group">

                <label>Пароль</label>

                <input
                    id="registerPassword"
                    type="password"
                    required
                    minlength="6"
                    placeholder="минимум 6 символов"
                >

            </div>


            <div class="form-group">

                <label>Пол</label>

                <div class="radio-row">

                    <button
                        type="button"
                        class="gender-btn active"
                        id="femaleGender"
                        onclick="selectGender('female')"
                    >
                        ♀ Женский
                    </button>

                    <button
                        type="button"
                        class="gender-btn"
                        id="maleGender"
                        onclick="selectGender('male')"
                    >
                        ♂ Мужской
                    </button>

                </div>

            </div>


            <button class="primary full">
                Создать аккаунт
            </button>

        </form>


        <div class="auth-switch">

            Уже есть аккаунт?

            <button onclick="showAuth('login')">
                Войти
            </button>

        </div>

    `;

}


function selectGender(gender){

    genderValue = gender;

    document
        .getElementById("femaleGender")
        ?.classList.toggle(
            "active",
            gender === "female"
        );

    document
        .getElementById("maleGender")
        ?.classList.toggle(
            "active",
            gender === "male"
        );

}


function register(event){

    event.preventDefault();

    const username =
        document
        .getElementById("registerUsername")
        .value
        .trim()
        .toLowerCase();

    const displayName =
        document
        .getElementById("registerName")
        .value
        .trim();

    const password =
        document
        .getElementById("registerPassword")
        .value;


    if(
        db.users.some(
            u => u.username === username
        )
    ){

        toast("Такой юзернейм уже занят.");

        return;

    }


    const user = {

        id:uid("user"),

        username,

        displayName,

        password,

        gender:genderValue,

        avatar:defaultAvatar(),

        cover:"",

        bio:"",

        createdAt:Date.now()

    };


    db.users.push(user);

    saveDB();

    currentUserId = user.id;

    localStorage.setItem(
        SESSION_KEY,
        currentUserId
    );

    startApp();

}


function login(event){

    event.preventDefault();

    const username =
        document
        .getElementById("loginUsername")
        .value
        .trim()
        .toLowerCase();

    const password =
        document
        .getElementById("loginPassword")
        .value;


    const user =
        db.users.find(
            u =>
                u.username === username &&
                u.password === password
        );


    if(!user){

        toast("Неверный юзернейм или пароль.");

        return;

    }


    currentUserId = user.id;

    localStorage.setItem(
        SESSION_KEY,
        currentUserId
    );

    startApp();

}


function logout(){

    closeMusicPlayer();

    currentUserId = null;

    localStorage.removeItem(
        SESSION_KEY
    );

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


    renderApp();

}


function renderApp(){

    const user =
        getCurrentUser();


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
                </button>

                <button
                    class="nav-btn"
                    data-page="messages"
                    onclick="navigate('messages')"
                >
                    💬 Сообщения
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

}


/* ============================================================
   NAVIGATION
   ============================================================ */

function navigate(page,id=null){

    currentPage = page;

    selectedProfileId =
        id || selectedProfileId;


    document
        .querySelectorAll(".nav-btn[data-page]")
        .forEach(btn => {

            btn.classList.toggle(
                "active",
                btn.dataset.page === page
            );

        });


    switch(page){

        case "feed":
            renderFeed();
            break;

        case "profile":
            renderProfile(
                id || currentUserId
            );
            break;

        case "friends":
            renderFriends();
            break;

        case "messages":
            renderMessages();
            break;

        case "music":
            renderMusic();
            break;

        case "edit":
            renderEditProfile();
            break;

        case "search":
            renderSearchResults(
                id || ""
            );
            break;

        default:
            renderFeed();

    }

}


/* ============================================================
   FEED
   ============================================================ */

function renderFeed(){

    const page =
        document.getElementById("page");


    const posts =
        [...db.posts]
        .sort(
            (a,b) =>
                b.createdAt - a.createdAt
        );


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

    const author =
        getUser(post.authorId);

    if(!author) return "";


    const liked =
        post.likes?.includes(
            currentUserId
        );


    const comments =
        db.comments
        .filter(
            c => c.postId === post.id
        )
        .sort(
            (a,b) =>
                a.createdAt-b.createdAt
        );


    return `

        <article class="card post">

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


async function createPost(){

    const text =
        document
        .getElementById("postText")
        .value
        .trim();

    const file =
        document
        .getElementById("postImage")
        .files[0];


    if(!text && !file){

        toast("Добавь текст или изображение.");

        return;

    }


    let image = "";

    if(file){

        if(!file.type.startsWith("image/")){

            toast("Можно загружать только изображения.");

            return;

        }

        if(file.size > 8 * 1024 * 1024){

            toast("Изображение слишком большое. Максимум 8 МБ.");

            return;

        }

        image =
            await fileToDataURL(file);

    }


    db.posts.push({

        id:uid("post"),

        authorId:currentUserId,

        text,

        image,

        likes:[],

        createdAt:Date.now()

    });


    saveDB();

    toast("Пост опубликован!");

    renderFeed();

}


function toggleLike(postId){

    const post =
        db.posts.find(
            p => p.id === postId
        );

    if(!post) return;


    if(!post.likes)
        post.likes = [];


    const index =
        post.likes.indexOf(
            currentUserId
        );


    if(index >= 0){

        post.likes.splice(index,1);

    }else{

        post.likes.push(
            currentUserId
        );

    }


    saveDB();

    renderFeed();

}


function addComment(postId){

    const input =
        document.getElementById(
            "comment-" + postId
        );


    if(!input) return;


    const text =
        input.value.trim();


    if(!text) return;


    db.comments.push({

        id:uid("comment"),

        postId,

        authorId:currentUserId,

        text,

        createdAt:Date.now()

    });


    saveDB();

    renderFeed();

}


function focusComment(postId){

    const input =
        document.getElementById(
            "comment-" + postId
        );

    if(input){

        input.focus();

        input.scrollIntoView({
            behavior:"smooth",
            block:"center"
        });

    }

}


async function sharePost(postId){

    const post =
        db.posts.find(
            p => p.id === postId
        );

    if(!post) return;


    const author =
        getUser(post.authorId);


    const text =
        `Пост ${author?.displayName || ""} в bubbles`;


    if(
        navigator.share
    ){

        try{

            await navigator.share({
                title:"bubbles",
                text
            });

        }catch{}

    }else{

        try{

            await navigator.clipboard.writeText(
                location.href
            );

            toast("Ссылка скопирована.");

        }catch{

            toast("Не удалось скопировать ссылку.");

        }

    }

}


function deletePost(postId){

    const post =
        db.posts.find(
            p => p.id === postId
        );


    if(!post || post.authorId !== currentUserId)
        return;


    if(!confirm("Удалить пост?"))
        return;


    db.posts =
        db.posts.filter(
            p => p.id !== postId
        );


    db.comments =
        db.comments.filter(
            c => c.postId !== postId
        );


    saveDB();

    renderFeed();

}


/* ============================================================
   PROFILE
   ============================================================ */

function renderProfile(userId){

    const user =
        getUser(userId);


    if(!user){

        navigate("feed");

        return;

    }


    const posts =
        db.posts
        .filter(
            p => p.authorId === user.id
        )
        .sort(
            (a,b) =>
                b.createdAt-a.createdAt
        );


    const friends =
        db.friends
        .filter(
            f =>
                f.user1 === user.id ||
                f.user2 === user.id
        );


    const music =
        db.music
        .filter(
            m => m.authorId === user.id
        );


    const isMe =
        user.id === currentUserId;


    const friend =
        isFriend(user.id);


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
                                <button
                                    class="${friend ? "danger" : "secondary"}"
                                    onclick="toggleFriend('${user.id}')"
                                >
                                    ${friend ? "− Удалить из друзей" : "+ Добавить в друзья"}
                                </button>

                                <button
                                    class="primary"
                                    onclick="openChat('${user.id}')"
                                >
                                    💬 Написать
                                </button>
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

    const author =
        getUser(music.authorId);


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

    const user =
        getCurrentUser();


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

    const file =
        input.files[0];

    if(!file) return;


    if(!file.type.startsWith("image/")){

        toast("Выбери изображение.");

        input.value = "";

        return;

    }


    const reader =
        new FileReader();


    reader.onload = e => {

        document
            .getElementById("editAvatarPreview")
            .src = e.target.result;

    };


    reader.readAsDataURL(file);

}


async function saveProfile(){

    const user =
        getCurrentUser();


    const username =
        document
        .getElementById("editUsername")
        .value
        .trim()
        .toLowerCase();


    const displayName =
        document
        .getElementById("editName")
        .value
        .trim();


    const bio =
        document
        .getElementById("editBio")
        .value
        .trim();


    if(!username || !displayName){

        toast("Заполни имя и юзернейм.");

        return;

    }


    const taken =
        db.users.some(
            u =>
                u.id !== user.id &&
                u.username === username
        );


    if(taken){

        toast("Этот юзернейм уже занят.");

        return;

    }


    const avatarFile =
        document
        .getElementById("editAvatar")
        .files[0];


    const coverFile =
        document
        .getElementById("editCover")
        .files[0];


    if(avatarFile){

        if(avatarFile.size > 5 * 1024 * 1024){

            toast("Аватар слишком большой. Максимум 5 МБ.");

            return;

        }

        user.avatar =
            await fileToDataURL(avatarFile);

    }


    if(coverFile){

        if(coverFile.size > 8 * 1024 * 1024){

            toast("Обложка слишком большая. Максимум 8 МБ.");

            return;

        }

        user.cover =
            await fileToDataURL(coverFile);

    }


    user.username =
        username;

    user.displayName =
        displayName;

    user.bio =
        bio;


    saveDB();

    toast("Профиль обновлён.");

    renderApp();

}


/* ============================================================
   FRIENDS
   ============================================================ */

function renderFriends(){

    const friends =
        db.friends
        .filter(
            f =>
                f.user1 === currentUserId ||
                f.user2 === currentUserId
        );


    const users =
        friends
        .map(f =>
            getUser(
                f.user1 === currentUserId
                ? f.user2
                : f.user1
            )
        )
        .filter(Boolean);


    document.getElementById("page").innerHTML = `

        <h1 class="section-title">
            🫂 Друзья
        </h1>


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
                "Найди пользователей и добавь их в друзья."
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


            <button
                class="primary"
                style="width:100%;"
                onclick="navigate('profile','${user.id}')"
            >
                Открыть
            </button>

        </div>

    `;

}


function toggleFriend(userId){

    if(userId === currentUserId)
        return;


    const index =
        db.friends.findIndex(
            f =>
                (f.user1 === currentUserId && f.user2 === userId) ||
                (f.user2 === currentUserId && f.user1 === userId)
        );


    if(index >= 0){

        db.friends.splice(index,1);

        toast("Пользователь удалён из друзей.");

    }else{

        db.friends.push({

            id:uid("friend"),

            user1:currentUserId,

            user2:userId,

            createdAt:Date.now()

        });

        toast("Пользователь добавлен в друзья.");

    }


    saveDB();

    renderProfile(userId);

}


/* ============================================================
   MESSAGES
   ============================================================ */

function openChat(userId){

    selectedChatId =
        userId;

    currentPage =
        "messages";

    renderMessages();

}


function renderMessages(){

    const friends =
        db.friends
        .filter(
            f =>
                f.user1 === currentUserId ||
                f.user2 === currentUserId
        );


    const users =
        friends
        .map(
            f =>
                getUser(
                    f.user1 === currentUserId
                    ? f.user2
                    : f.user1
                )
        )
        .filter(Boolean);


    if(
        !selectedChatId &&
        users.length
    ){

        selectedChatId =
            users[0].id;

    }


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


function renderConversation(user){

    const messages =
        db.messages
        .filter(
            m =>
                (m.from === currentUserId &&
                 m.to === user.id) ||
                (m.from === user.id &&
                 m.to === currentUserId)
        )
        .sort(
            (a,b) =>
                b.createdAt-a.createdAt
        );


    const last =
        messages[0];


    return `

        <div
            class="conversation ${selectedChatId === user.id ? "active" : ""}"
            onclick="openChat('${user.id}')"
        >

            <img
                class="mini-avatar"
                src="${user.avatar || defaultAvatar()}"
            >

            <div class="conversation-info">

                <strong>
                    ${escapeHtml(user.displayName)}
                </strong>

                <small>
                    ${
                        last
                        ? escapeHtml(last.text)
                        : "Нет сообщений"
                    }
                </small>

            </div>

        </div>

    `;

}


function renderChat(userId){

    const user =
        getUser(userId);


    const messages =
        db.messages
        .filter(
            m =>
                (m.from === currentUserId &&
                 m.to === userId) ||
                (m.from === userId &&
                 m.to === currentUserId)
        )
        .sort(
            (a,b) =>
                a.createdAt-b.createdAt
        );


    return `

        <div class="chat-header">

            <img
                class="mini-avatar"
                src="${user.avatar || defaultAvatar()}"
                style="width:30px;height:30px;vertical-align:middle;"
            >

            ${escapeHtml(user.displayName)}

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


        <form
            class="chat-input"
            onsubmit="sendMessage(event,'${userId}')"
        >

            <input
                id="messageInput"
                maxlength="1000"
                autocomplete="off"
                placeholder="Написать сообщение..."
                required
            >

            <button class="primary">
                Отправить
            </button>

        </form>

    `;

}


function messageBubble(message){

    return `

        <div class="message ${
            message.from === currentUserId
            ? "me"
            : "them"
        }">

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
            </small>

        </div>

    `;

}


function sendMessage(event,userId){

    event.preventDefault();


    const input =
        document.getElementById(
            "messageInput"
        );


    const text =
        input.value.trim();


    if(!text) return;


    db.messages.push({

        id:uid("message"),

        from:currentUserId,

        to:userId,

        text,

        createdAt:Date.now()

    });


    saveDB();

    renderMessages();

    setTimeout(()=>{

        const box =
            document.getElementById(
                "chatMessages"
            );

        if(box){

            box.scrollTop =
                box.scrollHeight;

        }

    },20);

}


/* ============================================================
   MUSIC
   ============================================================ */

function renderMusic(){

    const music =
        [...db.music]
        .sort(
            (a,b) =>
                b.createdAt-a.createdAt
        );


    document.getElementById("page").innerHTML = `

        <h1 class="section-title">
            🎵 Вся музыка
        </h1>


        <div class="card">

            <h3>
                Опубликовать музыку
            </h3>


            <div class="form-group">

                <label>
                    Название трека
                </label>

                <input
                    id="musicTitle"
                    maxlength="80"
                    placeholder="Название"
                >

            </div>


            <div class="form-group">

                <label>
                    Обложка
                </label>

                <input
                    id="musicCover"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                >

            </div>


            <div class="form-group">

                <label>
                    MP3-файл — максимум 15 МБ
                </label>

                <input
                    id="musicFile"
                    type="file"
                    accept=".mp3,audio/mpeg"
                >

            </div>


            <button
                class="primary"
                onclick="uploadMusic()"
            >
                🎵 Опубликовать MP3
            </button>

            <p style="
                color:#7899a7;
                font-size:12px;
                margin-bottom:0;
            ">
                Поддерживается только MP3.
                Загруженный файл не показывается
                как количество загрузок.
            </p>

        </div>


        ${
            music.length
            ? music.map(renderMusicCard).join("")
            : emptyState(
                "🎵",
                "Музыки пока нет",
                "Загрузи первый трек."
            )
        }

    `;

}


function renderMusicCard(music){

    const author =
        getUser(music.authorId);


    return `

        <div
            class="music-card"
            id="music-${music.id}"
        >

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
                    title="Слушать"
                >
                    ▶️
                </button>


                ${
                    music.authorId === currentUserId
                    ? `
                        <button
                            onclick="deleteMusic('${music.id}')"
                            title="Удалить"
                        >
                            🗑️
                        </button>
                    `
                    : ""
                }

            </div>

        </div>

    `;

}


async function uploadMusic(){

    const title =
        document
        .getElementById("musicTitle")
        .value
        .trim();


    const audioFile =
        document
        .getElementById("musicFile")
        .files[0];


    const coverFile =
        document
        .getElementById("musicCover")
        .files[0];


    if(!title){

        toast("Укажи название трека.");

        return;

    }


    if(!audioFile){

        toast("Выбери MP3-файл.");

        return;

    }


    if(audioFile.size > MAX_MUSIC_SIZE){

        toast("MP3 слишком большой. Максимум — 15 МБ.");

        return;

    }


    const isMP3 =
        audioFile.type === "audio/mpeg" ||
        audioFile.name
        .toLowerCase()
        .endsWith(".mp3");


    if(!isMP3){

        toast("Можно загружать только MP3.");

        return;

    }


    if(!musicDB){

        try{

            await openMusicDB();

        }catch{

            toast("IndexedDB недоступна.");

            return;

        }

    }


    if(coverFile){

        if(!coverFile.type.startsWith("image/")){

            toast("Обложка должна быть изображением.");

            return;

        }

        if(coverFile.size > 5 * 1024 * 1024){

            toast("Обложка слишком большая. Максимум 5 МБ.");

            return;

        }

    }


    const musicId =
        uid("music");


    try{

        await saveAudioFile(
            musicId,
            audioFile
        );


        let cover = "";

        if(coverFile){

            cover =
                await fileToDataURL(
                    coverFile
                );

        }


        db.music.push({

            id:musicId,

            authorId:currentUserId,

            title,

            cover,

            audioId:musicId,

            createdAt:Date.now()

        });


        saveDB();


        document
            .getElementById("musicTitle")
            .value = "";

        document
            .getElementById("musicFile")
            .value = "";

        document
            .getElementById("musicCover")
            .value = "";


        toast("Трек опубликован 🎵");

        renderMusic();

    }catch(error){

        console.error(error);

        try{

            await deleteAudioFile(
                musicId
            );

        }catch{}

        toast("Не удалось сохранить MP3.");

    }

}


async function playMusic(musicId){

    const music =
        db.music.find(
            m => m.id === musicId
        );


    if(!music){

        toast("Трек не найден.");

        return;

    }


    const audio =
        document.getElementById(
            "globalAudio"
        );


    if(
        currentlyPlayingMusicId === musicId &&
        !audio.paused
    ){

        return;

    }


    let url = "";


    if(music.audioId){

        try{

            const blob =
                await getAudioFile(
                    music.audioId
                );


            if(!blob){

                toast("Файл трека не найден.");

                return;

            }


            if(globalAudioURL){

                URL.revokeObjectURL(
                    globalAudioURL
                );

            }


            globalAudioURL =
                URL.createObjectURL(
                    blob
                );


            url =
                globalAudioURL;

        }catch(error){

            console.error(error);

            toast("Не удалось открыть MP3.");

            return;

        }

    }else if(music.audio){

        url =
            music.audio;

    }


    if(!url){

        toast("Аудиофайл отсутствует.");

        return;

    }


    currentlyPlayingMusicId =
        musicId;


    audio.src =
        url;


    document
        .getElementById(
            "globalPlayerCover"
        )
        .src =
        music.cover ||
        defaultMusicCover();


    const author =
        getUser(music.authorId);


    document
        .getElementById(
            "globalPlayerTitle"
        )
        .textContent =
        music.title;


    document
        .getElementById(
            "globalPlayerArtist"
        )
        .textContent =
        author
        ? "@" + author.username
        : "Unknown";


    document
        .getElementById(
            "globalPlayer"
        )
        .classList
        .remove("hidden");


    try{

        await audio.play();

    }catch(error){

        console.log(
            "Браузер ожидает действие пользователя.",
            error
        );

    }

}


function closeMusicPlayer(){

    const audio =
        document.getElementById(
            "globalAudio"
        );


    audio.pause();

    audio.removeAttribute(
        "src"
    );

    audio.load();


    currentlyPlayingMusicId =
        null;


    document
        .getElementById(
            "globalPlayer"
        )
        .classList
        .add("hidden");


    if(globalAudioURL){

        URL.revokeObjectURL(
            globalAudioURL
        );

        globalAudioURL =
            null;

    }

}


async function deleteMusic(id){

    const music =
        db.music.find(
            m => m.id === id
        );


    if(!music)
        return;


    if(music.authorId !== currentUserId)
        return;


    if(
        !confirm(
            "Удалить этот трек?"
        )
    ){

        return;

    }


    if(
        currentlyPlayingMusicId === id
    ){

        closeMusicPlayer();

    }


    if(music.audioId){

        try{

            await deleteAudioFile(
                music.audioId
            );

        }catch(error){

            console.error(error);

        }

    }


    db.music =
        db.music.filter(
            m => m.id !== id
        );


    saveDB();

    toast("Трек удалён.");

    renderMusic();

}


/* ============================================================
   SEARCH
   ============================================================ */

function searchUsers(value){

    const query =
        value
        .trim()
        .toLowerCase();


    if(!query){

        if(currentPage === "search")
            navigate("feed");

        return;

    }


    currentPage =
        "search";


    renderSearchResults(
        query
    );

}


function renderSearchResults(query){

    const users =
        db.users.filter(
            user =>
                user.id !== currentUserId &&
                (
                    user.username
                    .toLowerCase()
                    .includes(query) ||
                    user.displayName
                    .toLowerCase()
                    .includes(query)
                )
        );


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
   INIT
   ============================================================ */

(async function(){

    loadDB();


    try{

        await openMusicDB();

    }catch(error){

        console.error(
            "IndexedDB недоступна:",
            error
        );

    }


    if(
        currentUserId &&
        getCurrentUser()
    ){

        startApp();

    }else{

        showAuth("login");

    }

})();
