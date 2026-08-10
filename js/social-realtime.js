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

    console.log(
        '🔎 Ищем пост:',
        postId
    );

    /*
     * Ищем сам пост по data-post-id
     */

    const post =
        document.querySelector(
            `[data-post-id="${postId}"]`
        );


    if (!post) {

        console.warn(
            '❌ Пост с таким data-post-id не найден:',
            postId
        );

        /*
         * Показываем все элементы,
         * у которых вообще есть data-post-id.
         */

        const allPosts =
            document.querySelectorAll(
                '[data-post-id]'
            );

        console.log(
            '📋 Найденные посты:',
            allPosts
        );

        return null;
    }


    console.log(
        '✅ НУЖНЫЙ ПОСТ НАЙДЕН:',
        post
    );


    /*
     * Ищем элементы комментариев
     * внутри найденного поста.
     */

    const containers =
        post.querySelectorAll(
            '*'
        );


    console.log(
        '🔎 Элементы внутри поста:',
        containers
    );


    /*
     * Проверяем наиболее вероятные
     * варианты контейнера.
     */

    const selectors = [
        '.comments',
        '.comments-list',
        '.comment-list',
        '.post-comments',
        '.comments-container',
        '[class*="comment"]',
        '[id*="comment"]'
    ];


    for (
        const selector of selectors
    ) {

        const element =
            post.querySelector(
                selector
            );


        if (element) {

            console.log(
                '💬 КОНТЕЙНЕР НАЙДЕН:',
                selector,
                element
            );

            return element;
        }
    }


    console.warn(
        '❌ Внутри поста контейнер комментариев '
        + 'не найден'
    );


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
