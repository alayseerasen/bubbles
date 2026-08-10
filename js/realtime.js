console.log("🫧 REALTIME.JS ЗАГРУЗИЛСЯ!");

const sb = window.bubblesSupabase;

if (!sb) {
    console.error("❌ Supabase не найден");
} else {

    console.log("🫧 Supabase найден!");

    sb
        .channel("bubbles-messages")
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "messages"
            },
            (payload) => {

                console.log(
                    "💬 НОВОЕ СООБЩЕНИЕ ПОЛУЧЕНО:",
                    payload.new
                );

            }
        )
        .subscribe((status) => {

            console.log(
                "🫧 Realtime статус:",
                status
            );

        });
}
