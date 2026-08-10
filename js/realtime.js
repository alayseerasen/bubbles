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


    function messageAlreadyDisplayed(messageId) {

        return document.querySelector(
            `[data-bubbles-message-id="${messageId}"]`
        );
    }


    function displayRealtimeMessage(message) {

        const container =
            findMessagesContainer();

        if (!container) {

            console.warn(
                '⚠️ Не найден контейнер сообщений'
            );

            return;
        }


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

                async (payload) => {

                    console.log(
                        '⚡ Новое сообщение:',
                        payload.new
                    );


                    const message =
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
                     * НЕ ДОБАВЛЯЕМ СВОИ СООБЩЕНИЯ.
                     *
                     * Твой существующий код отправки
                     * уже показывает их.
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
                     * Показываем только сообщения,
                     * адресованные текущему пользователю.
                     */

                    if (
                        message.receiver_id !== user.id
                    ) {

                        console.log(
                            '↩️ Сообщение адресовано '
                            + 'другому пользователю'
                        );

                        return;
                    }


                    displayRealtimeMessage(
                        message
                    );

                }
            )

            .subscribe(
                (status) => {

                    console.log(
                        '🫧 Realtime status:',
                        status
                    );

                }
            );


    window.bubblesMessagesChannel =
        channel;


})();
