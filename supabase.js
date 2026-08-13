/* BUBBLES — Supabase client */
window.bubblesSupabase = window.supabase.createClient(
    window.BUBBLES_SUPABASE_URL,
    window.BUBBLES_SUPABASE_ANON_KEY,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    }
);
