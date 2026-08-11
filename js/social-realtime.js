/* ============================================
   BUBBLES — SOCIAL REALTIME
   COMMENTS + LIKES
   ============================================ */

(function () {

    const sb = window.bubblesSupabase;

    if (!sb) {
        console.error(
            '❌ Bubbles Supabase не найден'
        );
        return;
    }

    console.log(
        '🫧 Social Realtime запускается...'
    );


    /* ==========================================
       ПОИСК ПОСТА
       ========================================== */

    function findPostElement(postId) {

        /*
         * У Bubbles нет data-post-id.
         *
         * Поэтому ищем input комментария:
         *
         * comment-post_XXXXXXXX
         *
         * Затем поднимаемся до article.
         */

        const input =
            document.getElementById(
                `comment-${postId}`
            );


        if (!input) {

            console.warn(
                '⚠️ Input комментария не найден:',
                postId
            );

            return null;
        }


        const article =
            input.closest('article');


        if (!article) {

            console.warn(
                '⚠️ Article поста не найден:',
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
                '.post-actions'
            );


        if (!actions) {

            console.warn(
                '⚠️ .post-actions не найден'
            );

            return null;
        }


        /*
         * Первая кнопка — лайк.
         */

        const buttons =
            actions.querySelectorAll(
                '.action-btn'
            );


        if (!buttons.length) {

            console.warn(
                '⚠️ Кнопки поста не найдены'
            );

            return null;
        }


        return buttons[0];
    }


    /* ==========================================
       ОБНОВЛЕНИЕ ЛАЙКА
       ========================================== */

    function updatePostLikes(post) {

        const postElement =
            findPostElement(
                post.id
            );


        if (!postElement) {

            console.log(
                '↩️ Пост не найден:',
                post.id
            );

            return;
        }


        console.log(
            '✅ Пост найден:',
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
            '❤️ Новое количество лайков:',
            likesCount
        );


        /*
         * Определяем,
         * был ли лайк поставлен текущим пользователем.
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
                            data.user;


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
       ОТОБРАЖЕНИЕ КНОПКИ
       ========================================== */

    function renderLikeButton(
        button,
        count,
        liked
    ) {

        /*
         * Сохраняем onclick.
         *
         * Например:
         *
         * toggleLike('post_123')
         */

        const onclick =
            button.getAttribute(
                'onclick'
            );


        /*
         * Не трогаем саму функцию toggleLike.
         *
         * Меняем только содержимое кнопки.
         */

        button.innerHTML =
            `${liked ? '♥' : '♡'} ${count}`;


        /*
         * Сохраняем визуальный класс.
         */

        if (liked) {

            button.classList.add(
                'liked'
            );

        } else {

            button.classList.remove(
                'liked'
            );
        }


        /*
         * На всякий случай
         * возвращаем onclick.
         */

        if (onclick) {

            button.setAttribute(
                'onclick',
                onclick
            );
        }


        console.log(
            '❤️ Кнопка лайка обновлена:',
            count
        );
    }


    /* ==========================================
       REALTIME LIKES
       ========================================== */

    const likesChannel =
        sb
            .channel(
                'bubbles-likes-realtime'
            )

            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'posts'
                },

                function (payload) {

                    console.log(
                        '❤️ Обновление лайков:',
                        payload.new
                    );


                    updatePostLikes(
                        payload.new
                    );
                }
            )

            .subscribe(
                function (status) {

                    console.log(
                        '❤️ Likes Realtime:',
                        status
                    );
                }
            );


    window.bubblesLikesChannel =
        likesChannel;


    /* ==========================================
       COMMENTS
       ========================================== */

    function findCommentsContainer(
        postId
    ) {

        console.log(
            '🔎 Ищем контейнер комментариев:',
            postId
        );


        const input =
            document.getElementById(
                `comment-${postId}`
            );


        if (!input) {

            console.warn(
                '❌ Поле комментария не найдено:',
                postId
            );

            return null;
        }


        const article =
            input.closest('article');


        if (!article) {

            console.warn(
                '❌ Article комментариев не найден'
            );

            return null;
        }


        const container =
            article.querySelector(
                '.comment-list'
            );


        if (!container) {

            console.warn(
                '❌ .comment-list не найден'
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

        const container =
            findCommentsContainer(
                comment.post_id
            );


        if (!container) {

            console.warn(
                '⚠️ Контейнер комментариев не найден'
            );

            console.log(
                'Полученный комментарий:',
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
                '↩️ Комментарий уже отображается'
            );

            return;
        }


        const element =
            document.createElement(
                'div'
            );


        element.dataset
            .bubblesCommentId =
            comment.id;


        element.className =
            'comment realtime-comment';


        element.textContent =
            comment.text || '';


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
            '💬 Новый комментарий добавлен:',
            comment
        );
    }


    /* ==========================================
       REALTIME COMMENTS
       ========================================== */

    const commentsChannel =
        sb
            .channel(
                'bubbles-comments-realtime'
            )

            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'comments'
                },

                async function (payload) {

                    console.log(
                        '⚡ Новый комментарий:',
                        payload.new
                    );


                    const comment =
                        payload.new;


                    const {
                        data: {
                            user
                        }
                    } =
                        await sb.auth.getUser();


                    if (!user) {
                        return;
                    }


                    if (
                        commentAlreadyDisplayed(
                            comment.id
                        )
                    ) {

                        console.log(
                            '↩️ Комментарий уже существует'
                        );

                        return;
                    }


                    displayRealtimeComment(
                        comment
                    );
                }
            )

            .subscribe(
                function (status) {

                    console.log(
                        '💬 Comments Realtime:',
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
        '🟢 SOCIAL REALTIME ЗАГРУЖЕН — 003'
    );

})();
/* ============================================================
   REALTIME — ONLINE + NOW LISTENING
   ============================================================ */

function startProfileRealtime() {

    if (!window.bubblesSupabase) {
        console.error("Supabase не найден.");
        return;
    }

    const channel =
        window.bubblesSupabase
            .channel("bubbles-profiles-realtime")

            .on(
                "postgres_changes",
                {
                    event: "UPDATE",
                    schema: "public",
                    table: "profiles"
                },
                payload => {

                    const updated = payload.new;

                    if (!updated || !updated.id) {
                        return;
                    }

                    /*
                     * Обновляем пользователя
                     * в локальном db.users
                     */

                    const user =
                        db.users.find(
                            u => u.id === updated.id
                        );

                    if (!user) {
                        return;
                    }

                    user.lastSeen =
                        updated.last_seen || null;

                    user.currentTrack =
                        updated.current_track || "";

                    user.currentArtist =
                        updated.current_artist || "";


                    /*
                     * Если сейчас открыт профиль
                     * этого пользователя —
                     * перерисовываем его.
                     */

                    if (
                        currentPage === "profile" &&
                        selectedProfileId === updated.id
                    ) {

                        renderProfile(
                            updated.id
                        );

                    }

                }
            )

            .subscribe(status => {

                console.log(
                    "Profiles Realtime:",
                    status
                );

            });


    return channel;
}
