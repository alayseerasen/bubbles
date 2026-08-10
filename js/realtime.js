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


    /*
     * Пытаемся найти контейнер сообщений.
     * Если твой сайт использует один из этих ID —
     * сообщение будет добавлено автоматически.
     */

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


    /*
     * Проверяем, существует ли сообщение
     * на странице уже.
     */

    function messageAlreadyDisplayed(messageId) {

        return document.querySelector(
            `[data-bubbles-message-id="${messageId}"]`
        );
    }


    /*
     * Добавляем сообщение в интерфейс.
     */

    function displayRealtimeMessage(message) {

        const container =
            findMessagesContainer();

        if (!container) {

            console.warn(
                '⚠️ Не найден контейнер сообщений'
            );

            console.log(
                'Полученное сообщение:',
                message
            );

            return;
        }


        /*
         * Защита от дублей
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


        /*
         * Создаём элемент сообщения
         */

        const element =
            document.createElement('div');


        element.dataset.bubblesMessageId =
            message.id;


        element.className =
            'message realtime-message';


        /*
         * Сам текст сообщения
         */

        element.textContent =
            message.text || '';


        /*
         * Добавляем в чат
         */

        container.appendChild(element);


        /*
         * Прокручиваем чат вниз
         */

        container.scrollTop =
            container.scrollHeight;


        console.log(
            '💬 Сообщение добавлено в чат:',
            message
        );

    }


    /*
     * Подключаемся к Realtime
     */

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

                function (payload) {

                    console.log(
                        '⚡ Новое сообщение:',
                        payload.new
                    );


                    displayRealtimeMessage(
                        payload.new
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
     * Сохраняем канал глобально.
     * Это пригодится позже для отключения
     * подписки при закрытии чата.
     */

    window.bubblesMessagesChannel =
        channel;


})();
