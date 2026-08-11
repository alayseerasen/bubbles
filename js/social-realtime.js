/* ============================================
   BUBBLES — SOCIAL REALTIME
   POSTS + COMMENTS + LIKES
   ============================================ */

(function () {

    const sb = window.bubblesSupabase;

    if (!sb) {
        console.error(
            "❌ Bubbles Supabase не найден"
        );
        return;
    }

    console.log(
        "🫧 Social Realtime запускается..."
    );


    /* ==========================================
       ПОИСК ПОСТА
       ========================================== */

    function findPostElement(postId) {

        /*
         * Сначала пробуем новый способ:
         *
         * data-bubbles-post-id
         */

        const direct =
            document.querySelector(
                `[data-bubbles-post-id="${postId}"]`
            );

        if (direct) {
            return direct;
        }


        /*
         * Совместимость со старым app.js.
         *
         * Пока в renderPost()
         * нет data-bubbles-post-id,
         * ищем поле комментария.
         */

        const input =
            document.getElementById(
                `comment-${postId}`
            );


        if (!input) {

            console.warn(
                "⚠️ Input комментария не найден:",
                postId
            );

            return null;
        }


        const article =
            input.closest("article");


        if (!article) {

            console.warn(
                "⚠️ Article поста не найден:",
                postId
            );

            return null;
        }


        return article;
    }


    /* ==========================================
       ПОИСК СЧЁТЧИКА ЛАЙКОВ
       ========================================== */

    function findLikeButton(postElement) {

        if (!postElement) {
            return null;
        }


        const actions =
            postElement.querySelector(
                ".post-actions"
            );


        if (!actions) {

            console.warn(
                "⚠️ .post-actions не найден"
            );

            return null;
        }


        /*
         * Первая кнопка —
         * кнопка лайка.
         */

        const buttons =
            actions.querySelectorAll(
                ".action-btn"
            );


        if (!buttons.length) {

            console.warn(
                "⚠️ Кнопки поста не найдены"
            );

            return null;
        }


        return buttons[0];
    }


    /* ==========================================
       ОБНОВЛЕНИЕ ЛАЙКА
       ========================================== */

    function updatePostLikes(post) {

        if (!post || !post.id) {
            return;
        }


        const postElement =
            findPostElement(
                post.id
            );


        if (!postElement) {

            console.log(
                "↩️ Пост не найден:",
                post.id
            );

            return;
        }


        console.log(
            "✅ Пост найден:",
            postElement
        );


        const likeButton =
            findLikeButton(
                postElement
            );


        if (!likeButton) {
            return;
        }


        /*
         * likes у тебя является массивом.
         *
         * Например:
         *
         * []
         *
         * или
         *
         * ["user1", "user2"]
         */

        let likesCount = 0;


        if (
            Array.isArray(
                post.likes
            )
        ) {

            likesCount =
                post.likes.length;

        } else {

            likesCount =
                Number(
                    post.likes
                ) || 0;
        }


        console.log(
            "❤️ Новое количество лайков:",
            likesCount
        );


        /*
         * Определяем,
         * поставил ли лайк текущий пользователь.
         */

        let currentUserLiked =
            false;


        if (
            Array.isArray(
                post.likes
            )
        ) {

            sb.auth
                .getUser()
                .then(
                    ({ data }) => {

                        const user =
                            data?.user;


                        if (user) {

                            currentUserLiked =
                                post.likes.includes(
                                    user.id
                                );

                        }


                        renderLikeButton(
                            likeButton,
                            likesCount,
                            currentUserLiked
                        );

                    }
                )
                .catch(
                    error => {

                        console.error(
                            "Ошибка получения пользователя:",
                            error
                        );

                        renderLikeButton(
                            likeButton,
                            likesCount,
                            false
                        );

                    }
                );

        } else {

            renderLikeButton(
                likeButton,
                likesCount,
                false
            );

        }
    }


    /* ==========================================
       ОТОБРАЖЕНИЕ КНОПКИ ЛАЙКА
       ========================================== */

    function renderLikeButton(
        button,
        count,
        liked
    ) {

        if (!button) {
            return;
        }


        /*
         * Сохраняем onclick.
         */

        const onclick =
            button.getAttribute(
                "onclick"
            );


        /*
         * Меняем только содержимое.
         */

        button.innerHTML =
            `${liked ? "♥" : "♡"} ${count}`;


        /*
         * Визуальный класс.
         */

        if (liked) {

            button.classList.add(
                "liked"
            );

        } else {

            button.classList.remove(
                "liked"
            );

        }


        /*
         * Возвращаем onclick.
         */

        if (onclick) {

            button.setAttribute(
                "onclick",
                onclick
            );

        }


        console.log(
            "❤️ Кнопка лайка обновлена:",
            count
        );
    }


    /* ==========================================
       ПРЕОБРАЗОВАНИЕ POST SUPABASE → BUBBLES
       ========================================== */

    function convertRealtimePost(row) {

        if (!row) {
            return null;
        }


        /*
         * В app.js уже существует
         * rowToPost().
         *
         * Используем её, если она доступна.
         */

        if (
            typeof window.rowToPost ===
            "function"
        ) {

            try {

                return window.rowToPost(
                    row
                );

            } catch (error) {

                console.warn(
                    "⚠️ rowToPost() не сработал:",
                    error
                );

            }
        }


        /*
         * Запасной вариант.
         */

        return {

            id:
                row.id,

            authorId:
                row.author_id,

            text:
                row.text || "",

            image:
                row.image || "",

            likes:
                Array.isArray(row.likes)
                    ? row.likes
                    : [],

            createdAt:
                row.created_at
                    ? new Date(
                        row.created_at
                    ).getTime()
                    : Date.now()

        };
    }


    /* ==========================================
       ПРОВЕРКА ПОСТА В ЛОКАЛЬНОЙ DB
       ========================================== */

    function findLocalPost(
        postId
    ) {

        if (
            !window.db ||
            !Array.isArray(
                db.posts
            )
        ) {

            return null;
        }


        return db.posts.find(
            post =>
                post.id === postId
        );
    }


    /* ==========================================
       НОВЫЙ ПОСТ
       ========================================== */

    function displayRealtimePost(
        row
    ) {

        if (!row || !row.id) {
            return;
        }


        /*
         * Не добавляем пост повторно.
         */

        const existing =
            findLocalPost(
                row.id
            );


        if (existing) {

            console.log(
                "↩️ Пост уже существует:",
                row.id
            );

            return;
        }


        const post =
            convertRealtimePost(
                row
            );


        if (!post) {
            return;
        }


        /*
         * Добавляем в локальную DB.
         */

        db.posts.push(
            post
        );


        /*
         * Сортировка:
         * новые сверху.
         */

        db.posts.sort(
            (a, b) =>
                b.createdAt -
                a.createdAt
        );


        console.log(
            "📝 Новый пост добавлен:",
            post
        );


        /*
         * Если сейчас открыта лента —
         * перерисовываем её.
         */

        if (
            typeof currentPage !==
                "undefined" &&
            currentPage === "feed"
        ) {

            if (
                typeof renderFeed ===
                "function"
            ) {

                renderFeed();

            }

        }


        /*
         * Если открыт профиль автора —
         * обновляем профиль.
         */

        if (
            typeof currentPage !==
                "undefined" &&
            currentPage === "profile" &&
            typeof selectedProfileId !==
                "undefined" &&
            selectedProfileId ===
                post.authorId
        ) {

            if (
                typeof renderProfile ===
                "function"
            ) {

                renderProfile(
                    selectedProfileId
                );

            }

        }
    }


    /* ==========================================
       ОБНОВЛЕНИЕ ПОСТА
       ========================================== */

    function updateRealtimePost(
        row
    ) {

        if (!row || !row.id) {
            return;
        }


        /*
         * Находим существующий пост.
         */

        const index =
            db.posts.findIndex(
                post =>
                    post.id === row.id
            );


        /*
         * Если поста ещё нет —
         * считаем это новым постом.
         */

        if (index === -1) {

            displayRealtimePost(
                row
            );

            return;
        }


        /*
         * Сохраняем старое состояние.
         */

        const oldPost =
            db.posts[index];


        const updatedPost =
            convertRealtimePost(
                row
            );


        if (!updatedPost) {
            return;
        }


        /*
         * Обновляем локальную DB.
         */

        db.posts[index] =
            updatedPost;


        /*
         * ВАЖНО:
         *
         * Если изменилась только
         * информация о лайках,
         * не нужно полностью
         * перерисовывать ленту.
         */

        const oldLikes =
            JSON.stringify(
                oldPost.likes || []
            );

        const newLikes =
            JSON.stringify(
                updatedPost.likes || []
            );


        if (
            oldLikes !== newLikes
        ) {

            updatePostLikes(
                updatedPost
            );

        }


        /*
         * Если изменился текст
         * или изображение —
         * перерисовываем ленту.
         */

        const contentChanged =
            oldPost.text !==
                updatedPost.text ||
            oldPost.image !==
                updatedPost.image ||
            oldPost.authorId !==
                updatedPost.authorId;


        if (
            contentChanged &&
            typeof currentPage !==
                "undefined" &&
            currentPage === "feed"
        ) {

            if (
                typeof renderFeed ===
                "function"
            ) {

                renderFeed();

            }

        }


        /*
         * Профиль автора.
         */

        if (
            typeof currentPage !==
                "undefined" &&
            currentPage === "profile" &&
            typeof selectedProfileId !==
                "undefined" &&
            selectedProfileId ===
                updatedPost.authorId
        ) {

            if (
                typeof renderProfile ===
                "function"
            ) {

                renderProfile(
                    selectedProfileId
                );

            }

        }


        console.log(
            "🔄 Пост обновлён:",
            updatedPost
        );
    }


    /* ==========================================
       УДАЛЕНИЕ ПОСТА
       ========================================== */

    function deleteRealtimePost(
        row
    ) {

        if (!row || !row.id) {
            return;
        }


        /*
         * Запоминаем удаляемый пост.
         */

        const deletedPost =
            findLocalPost(
                row.id
            );


        /*
         * Удаляем из db.posts.
         */

        db.posts =
            db.posts.filter(
                post =>
                    post.id !== row.id
            );


        /*
         * Также удаляем комментарии
         * этого поста из локальной DB.
         */

        if (
            Array.isArray(
                db.comments
            )
        ) {

            db.comments =
                db.comments.filter(
                    comment =>
                        comment.postId !==
                        row.id
                );

        }


        /*
         * Удаляем карточку напрямую,
         * если она сейчас существует.
         */

        const postElement =
            findPostElement(
                row.id
            );


        if (postElement) {

            postElement.remove();

        }


        /*
         * Если лента теперь пустая —
         * перерисовываем её.
         */

        if (
            typeof currentPage !==
                "undefined" &&
            currentPage === "feed"
        ) {

            if (
                db.posts.length === 0 &&
                typeof renderFeed ===
                    "function"
            ) {

                renderFeed();

            }

        }


        /*
         * Профиль автора.
         */

        if (
            deletedPost &&
            typeof currentPage !==
                "undefined" &&
            currentPage === "profile" &&
            typeof selectedProfileId !==
                "undefined" &&
            selectedProfileId ===
                deletedPost.authorId
        ) {

            if (
                typeof renderProfile ===
                "function"
            ) {

                renderProfile(
                    selectedProfileId
                );

            }

        }


        console.log(
            "🗑️ Пост удалён:",
            row.id
        );
    }


    /* ==========================================
       REALTIME POSTS
       ========================================== */

    const postsChannel =
        sb
            .channel(
                "bubbles-posts-realtime"
            )


            /* ----------------------------------
               НОВЫЙ ПОСТ
               ---------------------------------- */

            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "posts"
                },

                function (
                    payload
                ) {

                    console.log(
                        "⚡ REALTIME INSERT posts:",
                        payload.new
                    );


                    displayRealtimePost(
                        payload.new
                    );

                }
            )
if (
    message.to ===
        currentUserId &&

    !currentChat
) {

    updateMessagesBadge();


    /*
     * Если мы находимся
     * в разделе сообщений,
     * обновляем список диалогов.
     */

    if (
        currentPage ===
        "messages"
    ) {

        renderMessages();

    }

}

            /* ----------------------------------
               ОБНОВЛЕНИЕ ПОСТА / ЛАЙКОВ
               ---------------------------------- */

            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "posts"
                },

                function (
                    payload
                ) {

                    console.log(
                        "⚡ REALTIME UPDATE posts:",
                        payload.new
                    );


                    updateRealtimePost(
                        payload.new
                    );

                }
            )


            /* ----------------------------------
               УДАЛЕНИЕ ПОСТА
               ---------------------------------- */

            .on(
                "postgres_changes",
                {
                    event: "DELETE",
                    schema: "public",
                    table: "posts"
                },

                function (
                    payload
                ) {

                    console.log(
                        "⚡ REALTIME DELETE posts:",
                        payload.old
                    );


                    deleteRealtimePost(
                        payload.old
                    );

                }
            )


            .subscribe(
                function (
                    status
                ) {

                    console.log(
                        "📝 Posts Realtime:",
                        status
                    );

                }
            );


    window.bubblesPostsChannel =
        postsChannel;


    /*
     * Старое имя оставляем,
     * чтобы другие части проекта
     * не сломались.
     */

    window.bubblesLikesChannel =
        postsChannel;


    /* ==========================================
       COMMENTS
       ========================================== */

    function findCommentsContainer(
        postId
    ) {

        console.log(
            "🔎 Ищем контейнер комментариев:",
            postId
        );


        const input =
            document.getElementById(
                `comment-${postId}`
            );


        if (!input) {

            console.warn(
                "❌ Поле комментария не найдено:",
                postId
            );

            return null;
        }


        const article =
            input.closest(
                "article"
            );


        if (!article) {

            console.warn(
                "❌ Article комментариев не найден"
            );

            return null;
        }


        const container =
            article.querySelector(
                ".comment-list"
            );


        if (!container) {

            console.warn(
                "❌ .comment-list не найден"
            );

            return null;
        }


        return container;
    }


    /* ==========================================
       ПРОВЕРКА ДУБЛИКАТОВ
       ========================================== */

    function commentAlreadyDisplayed(
        commentId
    ) {

        return document.querySelector(
            `[data-bubbles-comment-id="${commentId}"]`
        );

    }


    /* ==========================================
       ОТОБРАЖЕНИЕ КОММЕНТАРИЯ
       ========================================== */

    function displayRealtimeComment(
        comment
    ) {

        if (!comment) {
            return;
        }


        const container =
            findCommentsContainer(
                comment.post_id
            );


        if (!container) {

            console.warn(
                "⚠️ Контейнер комментариев не найден"
            );

            console.log(
                "Полученный комментарий:",
                comment
            );

            return;
        }


        if (
            commentAlreadyDisplayed(
                comment.id
            )
        ) {

            console.log(
                "↩️ Комментарий уже отображается"
            );

            return;
        }


        const element =
            document.createElement(
                "div"
            );


        element.dataset
            .bubblesCommentId =
            comment.id;


        element.className =
            "comment realtime-comment";


        /*
         * Добавляем имя автора,
         * если пользователь есть
         * в локальной базе.
         */

        const author =
            Array.isArray(
                db.users
            )
                ? db.users.find(
                    user =>
                        user.id ===
                        comment.author_id
                )
                : null;


        if (author) {

            const strong =
                document.createElement(
                    "strong"
                );

            strong.textContent =
                author.displayName ||
                author.username ||
                "Пользователь";


            element.appendChild(
                strong
            );


            element.appendChild(
                document.createTextNode(
                    " "
                )
            );

        }


        element.appendChild(
            document.createTextNode(
                comment.text || ""
            )
        );


        /*
         * В comment-list сначала идут
         * комментарии, а последним
         * находится блок с input.
         *
         * Поэтому вставляем перед ним.
         */

        const input =
            document.getElementById(
                `comment-${comment.post_id}`
            );


        const inputWrapper =
            input
                ? input.parentElement
                : null;


        if (
            inputWrapper &&
            inputWrapper.parentElement ===
                container
        ) {

            container.insertBefore(
                element,
                inputWrapper
            );

        } else {

            container.appendChild(
                element
            );

        }


        console.log(
            "💬 Новый комментарий добавлен:",
            comment
        );
    }


    /* ==========================================
       REALTIME COMMENTS
       ========================================== */

    const commentsChannel =
        sb
            .channel(
                "bubbles-comments-realtime"
            )

            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "comments"
                },

                async function (
                    payload
                ) {

                    console.log(
                        "⚡ Новый комментарий:",
                        payload.new
                    );


                    const comment =
                        payload.new;


                    /*
                     * Защита от повторного
                     * отображения.
                     */

                    if (
                        commentAlreadyDisplayed(
                            comment.id
                        )
                    ) {

                        console.log(
                            "↩️ Комментарий уже существует"
                        );

                        return;
                    }


                    /*
                     * Добавляем в локальную DB,
                     * если его там ещё нет.
                     */

                    const alreadyInDb =
                        Array.isArray(
                            db.comments
                        ) &&
                        db.comments.some(
                            item =>
                                item.id ===
                                comment.id
                        );


                    if (
                        !alreadyInDb &&
                        Array.isArray(
                            db.comments
                        )
                    ) {

                        db.comments.push({

                            id:
                                comment.id,

                            postId:
                                comment.post_id,

                            authorId:
                                comment.author_id,

                            text:
                                comment.text || "",

                            createdAt:
                                comment.created_at
                                    ? new Date(
                                        comment.created_at
                                    ).getTime()
                                    : Date.now()

                        });

                    }


                    displayRealtimeComment(
                        comment
                    );

                }
            )

            .subscribe(
                function (
                    status
                ) {

                    console.log(
                        "💬 Comments Realtime:",
                        status
                    );

                }
            );


    window.bubblesCommentsChannel =
        commentsChannel;


    /* ==========================================
       ГОТОВО
       ========================================== */

    console.log(
        "🟢 SOCIAL REALTIME ЗАГРУЖЕН — POSTS + LIKES + COMMENTS"
    );

})();


/* ============================================================
   REALTIME — ONLINE + NOW LISTENING
   ============================================================ */

function startProfileRealtime() {

    if (!window.bubblesSupabase) {

        console.error(
            "Supabase не найден."
        );

        return;
    }


    const channel =
        window.bubblesSupabase

            .channel(
                "bubbles-profiles-realtime"
            )

            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "profiles"
                },

                payload => {

                    const updated =
                        payload.new;


                    if (
                        !updated ||
                        !updated.id
                    ) {

                        return;
                    }


                    /*
                     * Обновляем пользователя
                     * в локальном db.users.
                     */

                    const user =
                        db.users.find(
                            u =>
                                u.id ===
                                updated.id
                        );


                    if (!user) {
                        return;
                    }


                    user.lastSeen =
                        updated.last_seen ||
                        null;


                    user.currentTrack =
                        updated.current_track ||
                        "";


                    user.currentArtist =
                        updated.current_artist ||
                        "";


                    /*
                     * Если сейчас открыт профиль
                     * этого пользователя —
                     * перерисовываем его.
                     */

                    if (
                        currentPage ===
                            "profile" &&
                        selectedProfileId ===
                            updated.id
                    ) {

                        renderProfile(
                            updated.id
                        );

                    }

                }
            )

            .subscribe(
                status => {

                    console.log(
                        "Profiles Realtime:",
                        status
                    );

                }
            );


    return channel;
}


/* ============================================================
   REALTIME — MESSAGES
   ============================================================ */

function startMessagesRealtime() {

    if (!window.bubblesSupabase) {

        console.error(
            "❌ Supabase не найден."
        );

        return null;
    }


    const sb =
        window.bubblesSupabase;


    console.log(
        "💬 Messages Realtime запускается..."
    );


    const channel =
        sb
            .channel(
                "bubbles-messages-realtime"
            )


            /* ==================================
               НОВОЕ СООБЩЕНИЕ
               ================================== */

            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "messages"
                },
                if (
    currentPage === "messages" &&
    currentChat
) {
                function (
                    payload
                ) {

                    const row =
                        payload.new;


                    if (!row) {
                        return;
                    }


                    console.log(
                        "⚡ Новое сообщение:",
                        row
                    );

                     if (
    message.to ===
        currentUserId &&

    !currentChat
) {

    updateMessagesBadge();


    /*
     * Если мы находимся
     * в разделе сообщений,
     * обновляем список диалогов.
     */

    if (
        currentPage ===
        "messages"
    ) {

        renderMessages();

    }

}
                    /*
                     * Преобразуем Supabase row
                     * в формат Bubbles.
                     */

                    const message =
                        rowToMessage(
                            row
                        );


                    if (!message) {
                        return;
                    }


                    /*
                     * Не добавляем сообщение
                     * дважды.
                     */

                    const exists =
                        db.messages.some(
                            item =>
                                item.id ===
                                message.id
                        );


                    if (!exists) {

                        db.messages.push(
                            message
                        );


                        /*
                         * Сортируем по времени.
                         */

                        db.messages.sort(
                            (
                                a,
                                b
                            ) =>
                                a.createdAt -
                                b.createdAt
                        );

                    }


                    /*
                     * Проверяем,
                     * относится ли сообщение
                     * к текущему открытому чату.
                     */

                    const currentChat =
                        (
                            message.from ===
                                currentUserId &&

                            message.to ===
                                selectedChatId
                        )
                        ||
                        (
                            message.from ===
                                selectedChatId &&

                            message.to ===
                                currentUserId
                        );


                    /*
                     * =================================
                     * ЕСЛИ ОТКРЫТ ЭТОТ ЧАТ
                     * =================================
                     */

                    if (
                        currentPage ===
                            "messages" &&

                        currentChat
                    ) {


                        renderMessages();


                        setTimeout(
                            function () {

                                const box =
                                    document.getElementById(
                                        "chatMessages"
                                    );


                                if (box) {

                                    box.scrollTop =
                                        box.scrollHeight;

                                }

                            },
                            20
                        );


                        /*
                         * Если сообщение входящее,
                         * сразу отмечаем прочитанным.
                         */

                        if (
                            message.to ===
                            currentUserId
                        ) {

                            markChatAsRead(
                                message.from
                            );

                        }


                        return;
                    }


                    /*
                     * =================================
                     * ПОЛЬЗОВАТЕЛЬ В ДРУГОМ РАЗДЕЛЕ
                     * =================================
                     *
                     * Вот это главное изменение.
                     */

                    if (
                        message.to ===
                        currentUserId
                    ) {

                        console.log(
                            "🔵 Новое непрочитанное сообщение от:",
                            message.from
                        );

                    }


                    /*
                     * Если пользователь находится
                     * в разделе Messages, но открыт
                     * другой чат — обновляем список
                     * диалогов.
                     */

                    if (
                        currentPage ===
                        "messages"
                    ) {

                        renderMessages();

                    }


                    /*
                     * Если пользователь находится
                     * вообще в другом разделе,
                     * ничего дополнительно делать
                     * не нужно.
                     *
                     * Сообщение уже находится
                     * в db.messages.
                     */

                }
            )


            /* ==================================
               ОБНОВЛЕНИЕ СООБЩЕНИЯ
               ================================== */

            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "messages"
                },

                function (
                    payload
                ) {

                    const row =
                        payload.new;


                    if (!row) {
                        return;
                    }


                    const message =
                        rowToMessage(
                            row
                        );


                    const index =
                        db.messages.findIndex(
                            item =>
                                item.id ===
                                message.id
                        );


                    if (index >= 0) {

                        db.messages[index] =
                            message;

                    } else {

                        db.messages.push(
                            message
                        );

                    }


                    /*
                     * Обновляем интерфейс,
                     * если пользователь сейчас
                     * находится в Messages.
                     */

                    if (
                        currentPage ===
                        "messages"
                    ) {

                        renderMessages();

                    }


                    console.log(
                        "🔄 Сообщение обновлено:",
                        message
                    );

                }
            )


            /* ==================================
               ПОДКЛЮЧЕНИЕ
               ================================== */

            .subscribe(
                function (
                    status
                ) {

                    console.log(
                        "💬 Messages Realtime:",
                        status
                    );


                    if (
                        status ===
                        "SUBSCRIBED"
                    ) {

                        console.log(
                            "🟢 Messages Realtime подключён!"
                        );

                    }


                    if (
                        status ===
                        "CHANNEL_ERROR"
                    ) {

                        console.error(
                            "🔴 Messages Realtime ошибка"
                        );

                    }


                    if (
                        status ===
                        "TIMED_OUT"
                    ) {

                        console.error(
                            "⏱️ Messages Realtime timeout"
                        );

                    }

                }
            );


    window.bubblesMessagesChannel =
        channel;


    return channel;

}
/* ============================================================
   TYPING STATUS
   ============================================================ */

let typingChannel = null;
let typingTimer = null;
let isTyping = false;

function initTypingRealtime(){

    if(!window.bubblesSupabase){
        console.error("Supabase не найден.");
        return;
    }

    typingChannel =
        window.bubblesSupabase
            .channel("bubbles-typing")

            .on(
                "broadcast",
                {
                    event: "typing"
                },
                payload => {

                    const data = payload.payload;

                    if(!data){
                        return;
                    }

                    /*
                     * Нас интересует только статус
                     * пользователя, с которым открыт чат.
                     */

                    if(
                        currentPage !== "messages" ||
                        selectedChatId !== data.userId
                    ){
                        return;
                    }

                    showTypingStatus(
                        data.userId,
                        data.typing
                    );

                }
            )

            .subscribe(status => {

                console.log(
                    "Typing Realtime:",
                    status
                );

            });
}


/*
 * Показываем / скрываем
 * "печатает..."
 */

function showTypingStatus(userId, typing){

    const user = getUser(userId);

    if(!user){
        return;
    }

    const header =
        document.querySelector(".chat-header");

    if(!header){
        return;
    }

    let typingElement =
        document.getElementById(
            "typingStatus"
        );

    if(typing){

        if(!typingElement){

            typingElement =
                document.createElement("span");

            typingElement.id =
                "typingStatus";

            typingElement.style.cssText = `
                margin-left:8px;
                font-size:12px;
                color:#62b8d4;
                font-weight:500;
            `;

            typingElement.textContent =
                "печатает...";

            header.appendChild(
                typingElement
            );
        }

    }else{

        if(typingElement){
            typingElement.remove();
        }

    }
}


/*
 * Отправляем статус печати
 */

function sendTypingStatus(typing){

    if(
        !typingChannel ||
        !currentUserId ||
        !selectedChatId
    ){
        return;
    }

    typingChannel.send({
        type:"broadcast",
        event:"typing",
        payload:{
            userId:currentUserId,
            typing:typing
        }
    });
}


/*
 * Вызывается при каждом вводе текста
 */

function handleTyping(){

    if(!isTyping){

        isTyping = true;

        sendTypingStatus(true);

    }

    clearTimeout(typingTimer);

    typingTimer =
        setTimeout(() => {

            isTyping = false;

            sendTypingStatus(false);

        },1500);
}


/*
 * Останавливаем статус,
 * когда сообщение отправлено
 */

function stopTyping(){

    clearTimeout(typingTimer);

    if(isTyping){

        isTyping = false;

        sendTypingStatus(false);

    }
}


initTypingRealtime();
/* ============================================================
   REALTIME — MESSAGES
   ============================================================ */

function startMessagesRealtime() {

    if (!window.bubblesSupabase) {

        console.error(
            "❌ Supabase не найден."
        );

        return null;
    }


    const sb =
        window.bubblesSupabase;


    console.log(
        "💬 Запускаем Messages Realtime..."
    );


    /*
     * Создаём локальное хранилище
     * непрочитанных сообщений.
     *
     * Оно специально находится
     * в window, чтобы не потерять
     * его при повторном запуске
     * функции.
     */

    if (
        !Array.isArray(
            window.bubblesUnreadMessages
        )
    ) {

        window.bubblesUnreadMessages =
            [];

    }


    /*
     * Проверяем, существует ли сообщение
     * уже в локальной базе.
     */

    function messageExists(
        messageId
    ) {

        if (
            !Array.isArray(
                db.messages
            )
        ) {

            return false;
        }


        return db.messages.some(
            message =>
                message.id ===
                messageId
        );

    }


    /*
     * Проверяем, относится ли сообщение
     * к открытому сейчас чату.
     */

    function isCurrentChat(
        message
    ) {

        if (
            typeof currentUserId ===
            "undefined" ||
            !currentUserId
        ) {

            return false;
        }


        if (
            typeof selectedChatId ===
            "undefined" ||
            !selectedChatId
        ) {

            return false;
        }


        return (

            (
                message.from ===
                    currentUserId &&

                message.to ===
                    selectedChatId
            )

            ||

            (
                message.from ===
                    selectedChatId &&

                message.to ===
                    currentUserId
            )

        );

    }


    /*
     * Проверяем, является ли сообщение
     * входящим для текущего пользователя.
     */

    function isIncomingMessage(
        message
    ) {

        if (
            typeof currentUserId ===
            "undefined" ||
            !currentUserId
        ) {

            return false;
        }


        return (
            message.to ===
            currentUserId
        );

    }


    /*
     * Добавляем сообщение
     * в список непрочитанных.
     */

    function addUnreadMessage(
        message
    ) {

        /*
         * Не добавляем повторно.
         */

        const alreadyUnread =
            window.bubblesUnreadMessages
                .some(
                    item =>
                        item.id ===
                        message.id
                );


        if (alreadyUnread) {
            return;
        }


        window.bubblesUnreadMessages.push(
            message
        );


        console.log(
            "🔵 Новое непрочитанное сообщение:",
            message
        );


        /*
         * Обновляем индикатор
         * непрочитанных сообщений.
         */

        updateUnreadMessagesUI();

    }


    /*
     * Удаляем сообщения
     * из непрочитанных.
     */

    function removeUnreadForChat(
        chatUserId
    ) {

        if (!chatUserId) {
            return;
        }


        window.bubblesUnreadMessages =
            window.bubblesUnreadMessages
                .filter(
                    message =>
                        !(
                            message.from ===
                                chatUserId &&

                            message.to ===
                                currentUserId
                        )
                );


        updateUnreadMessagesUI();

    }


    /*
     * Обновление индикатора
     * непрочитанных сообщений.
     *
     * Функция специально безопасная:
     * если в интерфейсе Bubbles пока
     * нет такого элемента — ничего
     * страшного не произойдёт.
     */

    function updateUnreadMessagesUI() {

        const count =
            window.bubblesUnreadMessages.length;


        /*
         * Несколько возможных ID,
         * чтобы функция могла работать
         * с существующим интерфейсом.
         */

        const selectors = [

            "#unreadMessages",

            "#messagesUnread",

            "#messagesBadge",

            ".messages-unread"

        ];


        let badge = null;


        for (
            const selector
            of selectors
        ) {

            badge =
                document.querySelector(
                    selector
                );


            if (badge) {
                break;
            }

        }


        /*
         * Если специального badge
         * ещё нет — просто выводим
         * информацию в console.
         */

        if (!badge) {

            console.log(
                "💬 Непрочитанных сообщений:",
                count
            );

            return;
        }


        if (count > 0) {

            badge.textContent =
                count > 99
                    ? "99+"
                    : String(count);

            badge.classList.remove(
                "hidden"
            );

        } else {

            badge.textContent =
                "";

            badge.classList.add(
                "hidden"
            );

        }

    }


    /*
     * Показываем уведомление
     * о новом сообщении.
     */

    function showMessageNotification(
        message
    ) {

        /*
         * Если пользователь уже
         * находится в этом чате —
         * отдельное уведомление
         * не нужно.
         */

        if (
            isCurrentChat(
                message
            )
        ) {

            return;
        }


        /*
         * Сначала пытаемся найти
         * пользователя в локальной DB.
         */

        let author = null;


        if (
            Array.isArray(
                db.users
            )
        ) {

            author =
                db.users.find(
                    user =>
                        user.id ===
                        message.from
                );

        }


        const senderName =
            author?.displayName ||
            author?.username ||
            "Новое сообщение";


        const text =
            message.text ||
            "Новое сообщение";


        /*
         * Если в проекте уже есть
         * toast() — используем его.
         */

        if (
            typeof toast ===
            "function"
        ) {

            toast(
                `${senderName}: ${text}`
            );

            return;
        }


        /*
         * Запасной вариант —
         * обычное браузерное уведомление.
         */

        if (
            document.hidden &&
            "Notification" in window
        ) {

            if (
                Notification.permission ===
                "granted"
            ) {

                try {

                    new Notification(
                        senderName,
                        {
                            body:
                                text,
                            tag:
                                `bubbles-message-${message.id}`
                        }
                    );

                } catch (error) {

                    console.warn(
                        "Не удалось показать Notification:",
                        error
                    );

                }

            }

        }

    }


    /*
     * Прокручиваем чат вниз,
     * когда новое сообщение
     * пришло в открытый чат.
     */

    function scrollChatToBottom() {

        setTimeout(
            function () {

                const box =
                    document.getElementById(
                        "chatMessages"
                    );


                if (!box) {
                    return;
                }


                box.scrollTop =
                    box.scrollHeight;

            },
            30
        );

    }


    /*
     * Главная обработка
     * входящего сообщения.
     */

    function handleRealtimeMessage(
        row
    ) {

        if (!row) {

            console.warn(
                "⚠️ Realtime прислал пустое сообщение"
            );

            return;
        }


        console.log(
            "⚡ Получено сообщение:",
            row
        );


        /*
         * Преобразуем Supabase row
         * в формат Bubbles.
         */

        let message;


        try {

            if (
                typeof rowToMessage ===
                "function"
            ) {

                message =
                    rowToMessage(
                        row
                    );

            } else {

                /*
                 * Запасной вариант.
                 */

                message = {

                    id:
                        row.id,

                    from:
                        row.from ||
                        row.sender_id ||
                        row.user_id,

                    to:
                        row.to ||
                        row.receiver_id,

                    text:
                        row.text ||
                        row.content ||
                        "",

                    createdAt:
                        row.created_at
                            ? new Date(
                                row.created_at
                            ).getTime()
                            : Date.now()

                };

            }

        } catch (error) {

            console.error(
                "❌ Ошибка rowToMessage():",
                error
            );

            return;
        }


        if (!message) {

            console.warn(
                "⚠️ Не удалось создать message"
            );

            return;
        }


        if (!message.id) {

            console.warn(
                "⚠️ У сообщения нет id:",
                message
            );

            return;
        }


        /*
         * ==================================================
         * САМОЕ ВАЖНОЕ
         * ==================================================
         *
         * Сообщение добавляется в db.messages
         * ВСЕГДА.
         *
         * Неважно, где находится пользователь:
         *
         * Feed
         * Profile
         * Music
         * Messages
         * Другой чат
         */

        if (
            !messageExists(
                message.id
            )
        ) {

            if (
                !Array.isArray(
                    db.messages
                )
            ) {

                db.messages = [];

            }


            db.messages.push(
                message
            );
           /*
 * Обновляем общий badge.
 */

updateMessagesBadge();


            /*
             * Сортируем сообщения
             * по времени.
             */

            db.messages.sort(
                (a, b) =>
                    a.createdAt -
                    b.createdAt
            );


            console.log(
                "💾 Сообщение сохранено в db.messages:",
                message.id
            );

        } else {

            console.log(
                "↩️ Сообщение уже есть:",
                message.id
            );

        }


        /*
         * Проверяем,
         * входящее ли это сообщение.
         */

        const incoming =
            isIncomingMessage(
                message
            );


        /*
         * Проверяем,
         * открыт ли сейчас
         * именно этот чат.
         */

        const currentChat =
            isCurrentChat(
                message
            );


        /*
         * ==================================================
         * ЕСЛИ ЭТО ВХОДЯЩЕЕ СООБЩЕНИЕ
         * И НЕ ОТКРЫТ ТЕКУЩИЙ ЧАТ
         * ==================================================
         */

        if (
            incoming &&
            !currentChat
        ) {

            addUnreadMessage(
                message
            );


            showMessageNotification(
                message
            );

        }


        /*
         * ==================================================
         * ЕСЛИ СЕЙЧАС ОТКРЫТ НУЖНЫЙ ЧАТ
         * ==================================================
         */

        if (
            currentChat &&
            typeof currentPage !==
                "undefined" &&
            currentPage ===
                "messages"
        ) {

            if (
                typeof renderMessages ===
                "function"
            ) {

                renderMessages();

            }


            scrollChatToBottom();


            /*
             * Если пользователь находится
             * в чате — эти сообщения уже
             * не считаем непрочитанными.
             */

            removeUnreadForChat(
                message.from
            );

        }


        /*
         * ==================================================
         * ЕСЛИ ПОЛЬЗОВАТЕЛЬ НАХОДИТСЯ
         * В ДРУГОЙ ВКЛАДКЕ BUBBLES
         * ==================================================
         *
         * Ничего дополнительно делать
         * не нужно.
         *
         * Сообщение уже находится
         * в db.messages.
         *
         * Когда пользователь откроет
         * Messages, renderMessages()
         * возьмёт его оттуда.
         */


        console.log(
            "✅ Сообщение полностью обработано:",
            message
        );

    }


    /*
     * ==================================================
     * СОЗДАЁМ REALTIME CHANNEL
     * ==================================================
     */

    const channel =
        sb

            .channel(
                "bubbles-messages-realtime"
            )


            /*
             * Слушаем INSERT.
             */

            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "messages"
                },

                function (
                    payload
                ) {

                    console.log(
                        "⚡ REALTIME MESSAGE INSERT:",
                        payload.new
                    );


                    handleRealtimeMessage(
                        payload.new
                    );

                }
            )


            /*
             * Подписываемся.
             */

            .subscribe(
                function (
                    status
                ) {

                    console.log(
                        "💬 Messages Realtime:",
                        status
                    );


                    if (
                        status ===
                        "SUBSCRIBED"
                    ) {

                        console.log(
                            "🟢 Messages Realtime подключён!"
                        );

                    }


                    if (
                        status ===
                        "CHANNEL_ERROR"
                    ) {

                        console.error(
                            "🔴 Ошибка Messages Realtime"
                        );

                    }


                    if (
                        status ===
                        "TIMED_OUT"
                    ) {

                        console.error(
                            "⏱️ Messages Realtime timeout"
                        );

                    }

                }
            );


    /*
     * Сохраняем channel глобально.
     */

    window.bubblesMessagesChannel =
        channel;


    /*
     * Экспортируем полезные функции,
     * чтобы app.js мог использовать их.
     */

    window.bubblesMessagesRealtime = {

        addUnreadMessage,

        removeUnreadForChat,

        updateUnreadMessagesUI,

        handleRealtimeMessage

    };


    /*
     * Первоначально обновляем
     * badge непрочитанных.
     */

    updateUnreadMessagesUI();


    console.log(
        "🟢 Messages Realtime полностью запущен."
    );


    return channel;

}
