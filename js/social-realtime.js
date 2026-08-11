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
            "Supabase не найден."
        );

        return;
    }


    window.bubblesSupabase

        .channel(
            "bubbles-messages-realtime"
        )

        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "messages"
            },

            payload => {

                const row =
                    payload.new;


                if (!row) {
                    return;
                }


                /*
                 * Превращаем строку Supabase
                 * в формат Bubbles.
                 */

                const message =
                    rowToMessage(
                        row
                    );


                /*
                 * Не добавляем сообщение
                 * повторно.
                 */

                const exists =
                    db.messages.some(
                        m =>
                            m.id ===
                            message.id
                    );


                if (exists) {
                    return;
                }


                db.messages.push(
                    message
                );


                /*
                 * Если сообщение относится
                 * к текущему открытому чату —
                 * обновляем его автоматически.
                 */

                const belongsToCurrentChat =
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


                if (
                    currentPage ===
                        "messages" &&
                    belongsToCurrentChat
                ) {

                    renderMessages();


                    setTimeout(
                        () => {

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

                }

            }
        )

        .subscribe(
            status => {

                console.log(
                    "Messages Realtime:",
                    status
                );

            }
        );

}
