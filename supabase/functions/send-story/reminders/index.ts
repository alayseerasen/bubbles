// BUBBLES — send-story-reminders Edge Function
// ------------------------------------------------------------
// Unlike send-push/ (triggered by a Database Webhook on INSERT), this
// one is triggered on a SCHEDULE — a pg_cron job calls this function
// every ~30 minutes (see README.md in this folder for setup).
//
// Each run: find stories expiring within the next 2 hours that (a)
// haven't had a reminder sent yet and (b) nobody has viewed yet, and
// push the author a "твоя история почти исчезнет, никто её не видел"
// nudge. Marks reminder_sent so the next run doesn't repeat it.
//
// Shares the same push-sending approach as send-push/index.ts, kept
// as a separate self-contained function rather than an import so each
// function can be deployed/edited independently, same as the existing
// one.

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function db(path: string, init: RequestInit = {}) {
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: init.method === "PATCH" ? "return=minimal" : "",
            ...(init.headers || {})
        }
    }).then(r => (r.status === 204 ? null : r.json()));
}

async function sendPushToUser(userId: string, title: string, body: string, tag: string) {
    const subs = await db(`push_subscriptions?user_id=eq.${userId}&select=id,endpoint,p256dh,auth`);
    if (!Array.isArray(subs) || !subs.length) return;
    const payloadJson = JSON.stringify({ title, body, tag });
    await Promise.all(subs.map(async (sub: any) => {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payloadJson
            );
        } catch (err: any) {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
                await db(`push_subscriptions?id=eq.${sub.id}`, { method: "DELETE" });
            } else {
                console.error("push send failed:", err?.statusCode, err?.body || err);
            }
        }
    }));
}

Deno.serve(async (_req) => {
    try {
        // Stories expiring in the next 2 hours, not yet reminded.
        const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        const stories = await db(
            `stories?expires_at=lte.${soon}&expires_at=gt.${new Date().toISOString()}&reminder_sent=eq.false&select=id,author_id`
        );
        if (!Array.isArray(stories) || !stories.length) return new Response("nothing due", { status: 200 });

        let sent = 0;
        for (const story of stories) {
            // Skip stories someone has already seen — the nudge is only
            // for "this is about to disappear with zero views".
            const views = await db(`story_views?story_id=eq.${story.id}&select=id&limit=1`);
            if (Array.isArray(views) && views.length > 0) {
                await db(`stories?id=eq.${story.id}`, { method: "PATCH", body: JSON.stringify({ reminder_sent: true }) });
                continue;
            }

            await sendPushToUser(
                story.author_id,
                "Bubbles",
                "Твоя история почти исчезнет, и её ещё никто не видел 👀",
                `story-reminder-${story.id}`
            );
            await db(`stories?id=eq.${story.id}`, { method: "PATCH", body: JSON.stringify({ reminder_sent: true }) });
            sent++;
        }

        return new Response(`ok, reminded ${sent} of ${stories.length}`, { status: 200 });
    } catch (error) {
        console.error(error);
        return new Response("error", { status: 500 });
    }
});
