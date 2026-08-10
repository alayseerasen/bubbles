/* ============================================
   BUBBLES — SOCIAL REALTIME
   COMMENTS + POST UPDATES
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

        const possibleIds = [
            'comments',
            'commentsList',
            'commentList',
            'postComments',
            'comments-container'
        ];

        for (const id of possibleIds) {

            const element =
                document.getElementById(id);

            if (element) {
                return element;
            }
        }

        /*
         * Если комментарии находятся внутри
         * поста, попробуем найти контейнер
         * по data-post-id.
         */

        const post =
            document.querySelector(
                `[data-post-id="${postId}"]`
            );

        if (post) {

            const container =
                post.querySelector(
                    '.comments'
                );

            if (container) {
                return container;
            }
        }

        return null;
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
                '⚠️ Контейнер комментариев '
                + 'не найден'
            );

            console.log(
                'Полученный комментарий:',
                comment
            );

            return;
        }


        /*
         * Защита от дублей
         */

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


        container.appendChild(
            element
        );


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


                    /*
                     * Проверяем пользователя
                     */

                    const {
                        data: {
                            user
                        }
                    } =
                        await sb.auth.getUser();


                    if (!user) {
                        return;
                    }


                    /*
                     * Если комментарий уже добавлен
                     * существующим кодом —
                     * Realtime не добавляет его повторно.
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


                    /*
                     * Добавляем комментарий.
                     */

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


})();
