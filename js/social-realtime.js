/* ============================================
   BUBBLES — SOCIAL REALTIME
   COMMENTS + LIKES
   ============================================ */

(function () {

    const sb = window.bubblesSupabase;

    if (!sb) {
        console.error('❌ Bubbles Supabase не найден');
        return;
    }

    console.log('🫧 Social Realtime запускается...');


    /* ==========================================
       COMMENTS
       ========================================== */

    function findCommentsContainer(postId) {

        console.log(
            '🔎 Ищем контейнер комментариев для поста:',
            postId
        );

        const input = document.getElementById(
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

        const form = input.closest('form');

        if (form && form.parentElement) {

            console.log(
                '💬 Контейнер комментариев найден:',
                form.parentElement
            );

            return form.parentElement;
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


    function commentAlreadyDisplayed(commentId) {

        return document.querySelector(
            `[data-bubbles-comment-id="${commentId}"]`
        );
    }


    function displayRealtimeComment(comment) {

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
       COMMENTS REALTIME
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
       LIKES REALTIME
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

                    const post =
                        payload.new;


                    /* --------------------------------
                       ИЩЕМ ПОСТ
                       -------------------------------- */

                    let postElement =
                        document.querySelector(
                            `[data-post-id="${post.id}"]`
                        );


                    if (!postElement) {

                        postElement =
                            document.getElementById(
                                post.id
                            );
                    }


                    if (!postElement) {

                        const allPosts =
                            document.querySelectorAll(
                                '[data-post-id]'
                            );

                        console.log(
                            '🔎 Пост не найден по data-post-id.',
                            'Доступные элементы:',
                            allPosts
                        );

                        console.log(
                            '🔎 Ищем элементы с ID:',
                            document.querySelectorAll(
                                `[id*="${post.id}"]`
                            )
                        );

                        return;
                    }


                    console.log(
                        '✅ Пост найден:',
                        postElement
                    );


                    /* --------------------------------
                       ПОЛУЧАЕМ КОЛИЧЕСТВО ЛАЙКОВ
                       -------------------------------- */

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


                    /* --------------------------------
                       ИЩЕМ СЧЁТЧИК
                       -------------------------------- */

                    let likeCounter =
                        postElement.querySelector(
                            '[data-like-count]'
                        );


                    if (!likeCounter) {

                        likeCounter =
                            postElement.querySelector(
                                '.like-count'
                            );
                    }


                    if (!likeCounter) {

                        likeCounter =
                            postElement.querySelector(
                                '.likes-count'
                            );
                    }


                    if (!likeCounter) {

                        likeCounter =
                            postElement.querySelector(
                                '[class*="like-count"]'
                            );
                    }


                    if (!likeCounter) {

                        likeCounter =
                            postElement.querySelector(
                                '[class*="likes-count"]'
                            );
                    }


                    if (!likeCounter) {

                        console.warn(
                            '⚠️ Счётчик лайков внутри поста не найден'
                        );

                        return;
                    }


                    /* --------------------------------
                       ОБНОВЛЯЕМ СЧЁТЧИК
                       -------------------------------- */

                    likeCounter.textContent =
                        likesCount;


                    console.log(
                        '❤️ Счётчик лайков обновлён:',
                        likesCount
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
       ГОТОВО
       ========================================== */

    console.log(
        '🟢 SOCIAL REALTIME ЗАГРУЖЕН — COMMENTS + LIKES'
    );

})();
