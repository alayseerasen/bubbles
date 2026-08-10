/* BUBBLES — REALTIME TEST */

(function () {

    const sb = window.bubblesSupabase;

    if (!sb) {
        console.error('Bubbles Supabase не найден.');
        return;
    }

    const channel = sb
        .channel('bubbles-messages-realtime')

        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages'
            },
            function (payload) {

                console.log(
                    '🫧 НОВОЕ СООБЩЕНИЕ:',
                    payload.new
                );

            }
        )

        .subscribe(function (status) {

            console.log(
                '🫧 Bubbles Realtime:',
                status
            );

        });

})();
