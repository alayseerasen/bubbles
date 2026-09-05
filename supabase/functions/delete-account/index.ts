// BUBBLES — delete-account Edge Function
// ------------------------------------------------------------
// Full self-service account deletion. The client (anon key) can never
// do this itself: deleting the auth.users row requires the Admin API,
// which only works with the service role key — and that key must
// never reach the browser. So this function:
//
//   1) Verifies the caller's own JWT (passed as a normal
//      "Authorization: Bearer <user's access token>" header) to find
//      out WHO is asking — nobody can delete anyone but themselves.
//   2) Deletes their files from Storage (avatar/cover/music — these
//      live in storage.objects, which is NOT covered by the
//      "on delete cascade" foreign keys in supabase.sql, so they'd
//      otherwise be orphaned forever).
//   3) Deletes the auth.users row via the Admin API. Every table in
//      supabase.sql references profiles(id) with "on delete cascade",
//      and profiles.id references auth.users(id) with "on delete
//      cascade" too — so this one call cascades through profiles,
//      posts, comments, messages, friendships, music, everything.
//
// Deploy: supabase functions deploy delete-account
// Call from the client:
//   const { data: { session } } = await sb.auth.getSession();
//   await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
//       method: "POST",
//       headers: { Authorization: `Bearer ${session.access_token}` }
//   });
//   await sb.auth.signOut();

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function admin(path: string, init: RequestInit = {}) {
    return fetch(`${SUPABASE_URL}${path}`, {
        ...init,
        headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            ...(init.headers || {})
        }
    });
}

async function getUserIdFromToken(accessToken: string): Promise<string | null> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id || null;
}

async function deleteStorageFolder(bucket: string, userId: string) {
    // List everything under {userId}/ in this bucket, then remove it.
    // Errors here are logged but never block account deletion — a
    // leftover file is a much smaller problem than a person being
    // unable to delete their account at all.
    try {
        const listRes = await admin(`/storage/v1/object/list/${bucket}`, {
            method: "POST",
            body: JSON.stringify({ prefix: `${userId}/`, limit: 1000 })
        });
        const files = await listRes.json();
        if (!Array.isArray(files) || !files.length) return;
        const prefixes = files.map((f: any) => `${userId}/${f.name}`);
        await admin(`/storage/v1/object/${bucket}`, {
            method: "DELETE",
            body: JSON.stringify({ prefixes })
        });
    } catch (err) {
        console.error(`storage cleanup failed for ${bucket}/${userId}:`, err);
    }
}

Deno.serve(async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    const authHeader = req.headers.get("Authorization") || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!accessToken) return new Response("missing authorization", { status: 401 });

    const userId = await getUserIdFromToken(accessToken);
    if (!userId) return new Response("invalid session", { status: 401 });

    try {
        await Promise.all([
            deleteStorageFolder("images", userId),
            deleteStorageFolder("music", userId)
        ]);

        const delRes = await admin(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
        if (!delRes.ok) {
            const body = await delRes.text();
            console.error("admin delete user failed:", delRes.status, body);
            return new Response("failed to delete account", { status: 500 });
        }

        return new Response("ok", { status: 200 });
    } catch (error) {
        console.error(error);
        return new Response("error", { status: 500 });
    }
});
