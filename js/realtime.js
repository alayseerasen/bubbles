/* ============================================
   BUBBLES — REALTIME MESSAGES
   ============================================ */

(function () {

    const sb = window.bubblesSupabase;

    if (!sb) {
        console.error('❌ Bubbles Supabase не найден');
        return;
    }

    console.log('🫧 Bubbles Realtime запускается...');


    /* ------------------------------------------
       ИЩЕМ КОНТЕЙНЕР СООБЩЕНИЙ
       ------------------------------------------ */

    function findMessagesContainer() {

        const possibleIds = [
            'messages',
            'messageList',
            'messagesList',
            'chatMessages',
            'chat-messages',
            'chatMessagesList',
            'message-list',
            'messages-container'
        ];

        for (const id of possibleIds) {

            const element =
                document.getElementById(id);

            if (element) {
                return element;
            }
        }

        return null;
    }


    /* ------------------------------------------
       ПРОВЕРКА НА ДУБЛЬ
       ------------------------------------------ */

    function messageAlreadyDisplayed(messageId) {

        return document.querySelector(
            `[data-bubbles-message-id="${messageId}"]`
        );
    }


    /* ------------------------------------------
       ДОБАВЛЕНИЕ СООБЩЕНИЯ
       ------------------------------------------ */

    function displayRealtimeMessage(message) {

        const container =
            findMessagesContainer();

        if (!container) {

            console.warn(
                '⚠️ Не найден контейнер сообщений'
            );

            return;
        }


        /*
         * Если сообщение уже есть —
         * ничего не делаем.
         */

        if (
            messageAlreadyDisplayed(
                message.id
            )
        ) {

            console.log(
                '↩️ Сообщение уже отображается'
            );

            return;
        }


        const element =
            document.createElement('div');


        element.dataset.bubblesMessageId =
            message.id;


        element.className =
            'message realtime-message';


        element.textContent =
            message.text || '';


        container.appendChild(
            element
        );


        container.scrollTop =
            container.scrollHeight;


        console.log(
            '💬 Новое сообщение добавлено:',
            message
        );
    }


    /* ------------------------------------------
       REALTIME
       ------------------------------------------ */

    const channel =
        sb
            .channel(
                'bubbles-messages-realtime'
            )

            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages'
                },

                async function (payload) {

                    console.log(
                        '⚡ Новое сообщение:',
                        payload.new
                    );


                    const message =
                        payload.new;


                    /*
                     * Получаем текущего пользователя
                     */

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
                     * --------------------------------
                     * НЕ ПОКАЗЫВАЕМ СВОЁ СООБЩЕНИЕ
                     * --------------------------------
                     *
                     * Твой существующий код отправки
                     * уже показывает его на экране.
                     */

                    if (
                        message.sender_id === user.id
                    ) {

                        console.log(
                            '↩️ Своё сообщение — пропускаем'
                        );

                        return;
                    }


                    /*
                     * --------------------------------
                     * ПРОВЕРЯЕМ ПОЛУЧАТЕЛЯ
                     * --------------------------------
                     */

                    if (
                        message.receiver_id !== user.id
                    ) {

                        console.log(
                            '↩️ Сообщение предназначено '
                            + 'другому пользователю'
                        );

                        return;
                    }


                    /*
                     * --------------------------------
                     * ПОКАЗЫВАЕМ СООБЩЕНИЕ
                     * --------------------------------
                     */

                    displayRealtimeMessage(
                        message
                    );

                }
            )

            .subscribe(
                function (status) {

                    console.log(
                        '🫧 Realtime status:',
                        status
                    );

                }
            );


    /*
     * Сохраняем канал
     */

    window.bubblesMessagesChannel =
        channel;


})();
