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
       const likesChannel =
    sb
        .channel('bubbles-likes-realtime')

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

                /*
                 * Ищем пост по его ID.
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
                 * Ищем счётчик лайков.
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
                 * Запасной вариант:
                 * ищем элементы с классом/ID,
                 * связанным с лайками.
                 */

                const possibleCounter =
                    postElement.querySelector(
                        '.like-count, .likes-count, [class*="like-count"]'
                    );

                if (possibleCounter) {

                    possibleCounter.textContent =
                        post.likes ?? 0;

                    console.log(
                        '❤️ Счётчик лайков обновлён'
                    );
                }

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
    );


    /* ==========================================
       COMMENTS
       ========================================== */

 function findCommentsContainer(postId) {

    console.log(
        '🔎 Ищем контейнер комментариев для поста:',
        postId
    );

    /*
     * Находим поле ввода комментария.
     *
     * Например:
     * input#comment-post_msneb6qf_vzmav6
     */

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


    /*
     * Если input находится внутри form,
     * то контейнером комментариев обычно
     * является родитель этого form.
     */

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


    /*
     * Если формы нет, поднимаемся на один уровень.
     */

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

      console.log(
    '🟢 НОВАЯ ВЕРСИЯ SOCIAL-REALTIME ЗАГРУЖЕНА — 001'
);
})();
