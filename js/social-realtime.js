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
       COMMENTS
       ========================================== */

    function findCommentsContainer(postId) {

        console.log(
            '🔎 Ищем контейнер комментариев для поста:',
            postId
        );


        const input =
            document.getElementById(
                `comment-${postId}`
            );


        if (!input) {

            console.warn(
                '❌ Поле комментария не найдено:',
                `comment-${postId}`
            );

            return null;
        }


        console.log(
            '📝 Поле комментария найдено:',
            input
        );


        const form =
            input.closest('form');


        if (form && form.parentElement) {

            const container =
                form.parentElement;


            console.log(
                '💬 Контейнер комментариев найден:',
                container
            );


            return container;
        }


        if (input.parentElement) {

            console.log(
                '💬 Используем родительский контейнер:',
                input.parentElement
            );


            return input.parentElement;
        }


        return null;
    }


    /* ==========================================
       ПРОВЕРКА ДУБЛИКАТОВ КОММЕНТАРИЕВ
       ========================================== */

    function commentAlreadyDisplayed(
        commentId
    ) {

        return document.querySelector(
            `[data-bubbles-comment-id="${commentId}"]`
        );
    }


    /* ==========================================
       ДОБАВЛЕНИЕ КОММЕНТАРИЯ
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
            document.createElement('div');


        element.dataset.bubblesCommentId =
            comment.id;


        element.className =
            'comment realtime-comment';


        element.textContent =
            comment.text || '';


        /*
         * Если внутри контейнера есть форма,
         * ставим комментарий перед ней.
         */

        const form =
            container.querySelector('form');


        if (form) {

            container.insertBefore(
                element,
                form
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

                async (payload) => {

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

                        console.log(
                            '❌ Пользователь не авторизован'
                        );

                        return;
                    }


                    /*
                     * Защита от дублей.
                     */

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
                (status) => {

                    console.log(
                        '💬 Comments Realtime:',
                        status
                    );

                }
            );


    window.bubblesCommentsChannel =
        commentsChannel;


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

                   console.log(
                         '🔎 Все элементы с data-post-id:',
                         document.querySelectorAll('[data-post-id]')
                    );


                    const post =
                        payload.new;


                    /*
                     * Ищем сам пост.
                     */

                    const postElement =
                        document.querySelector(
                            `[data-post-id="${post.id}"]`
                        );


                    if (!postElement) {

                        console.log(
                            '↩️ Пост не найден на странице:',
                            post.id
                        );

                        return;
                    }


                    /*
                     * Основной вариант:
                     * data-like-count
                     */

                    const likeCounter =
                        postElement.querySelector(
                            '[data-like-count]'
                        );


                    if (likeCounter) {

                        likeCounter.textContent =
                            post.likes ?? 0;


                        console.log(
                            '❤️ Счётчик лайков обновлён:',
                            post.likes
                        );

                        return;
                    }


                    /*
                     * Запасные варианты.
                     */

                    const possibleCounter =
                        postElement.querySelector(
                            '.like-count, .likes-count, [class*="like-count"]'
                        );


                    if (possibleCounter) {

                        possibleCounter.textContent =
                            post.likes ?? 0;


                        console.log(
                            '❤️ Счётчик лайков обновлён:',
                            post.likes
                        );

                        return;
                    }


                    console.warn(
                        '⚠️ Счётчик лайков не найден в посте:',
                        post.id
                    );

                }
            )

            .subscribe(
                (status) => {

                    console.log(
                        '❤️ Likes Realtime:',
                        status
                    );

                }
            );


    window.bubblesLikesChannel =
        likesChannel;


    /* ==========================================
       ВЕРСИЯ
       ========================================== */

    console.log(
        '🟢 НОВАЯ ВЕРСИЯ SOCIAL-REALTIME ЗАГРУЖЕНА — 002'
    );

})();
