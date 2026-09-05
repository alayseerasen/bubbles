// BUBBLES — send-push Edge Function
// ------------------------------------------------------------
// Triggered by three Supabase Database Webhooks:
//   1) INSERT on public.bubbles_notifications  (likes, comments, friend requests/accepts)
//   2) INSERT on public.messages               (new chat message)
//   3) INSERT on public.call_invites           (someone started a call)
//
// All three webhooks point at THIS SAME function. Supabase's webhook payload
// includes a "table" field, so this figures out which one fired and
// builds an appropriate title/body, then pushes it to every device
// (row in push_subscriptions) the recipient has registered.
//
// Deliberately does NOT decrypt message text to put in the push body,
// on purpose, independent of whatever the current message-encryption
// scheme is: a push notification is the wrong place to put message
// content regardless (it can land on a lock screen, gets logged by
// the push service in transit, etc). The push just says "new message
// from X"; the actual content only ever gets decrypted client-side.
// See README.md in this folder for how to deploy this + wire up the
// two webhooks.

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
            ...(init.headers || {})
        }
    }).then(r => r.json());
}

const NOTIF_TEXT: Record<string, string> = {
    friend_request: "отправил(а) тебе заявку в друзья 🫂",
    friend_accept: "принял(а) твою заявку в друзья 🎉",
    post_like: "оценил(а) твой пост ❤️",
    post_comment: "прокомментировал(а) твой пост 💬",
    comment_reply: "ответил(а) на твой комментарий 💬",
    comment_like: "оценил(а) твой комментарий ❤️",
    wall_post: "оставил(а) запись на твоей стене 🧱",
    pet_fed: "покормил(а) твоего питомца 🍬"
};

async function buildPushForNotification(row: any) {
    const [actor] = await db(`profiles?id=eq.${row.actor_id}&select=display_name,username`);
    const name = actor?.display_name || actor?.username || "Кто-то";
    const text = NOTIF_TEXT[row.type] || "новое уведомление";
    return { userId: row.user_id, title: "Bubbles", body: `${name} ${text}`, tag: `notif-${row.type}-${row.post_id || row.id}` };
}

async function buildPushForMessage(row: any) {
    const [sender] = await db(`profiles?id=eq.${row.sender_id}&select=display_name,username`);
    const name = sender?.display_name || sender?.username || "Кто-то";
    return { userId: row.receiver_id, title: name, body: "Новое сообщение 💬", tag: `msg-${row.sender_id}` };
}

async function buildPushForCallInvite(row: any) {
    const [caller] = await db(`profiles?id=eq.${row.caller_id}&select=display_name,username`);
    const name = caller?.display_name || caller?.username || "Кто-то";
    // tag is deliberately NOT per-call — a second call from the same
    // person while the first push is still showing should replace it,
    // not stack a pile of "звонок от Х" notifications.
    return { userId: row.callee_id, title: "📞 Входящий звонок", body: `${name} звонит тебе в Bubbles`, tag: `call-${row.caller_id}` };
}

Deno.serve(async (req) => {
    try {
        const payload = await req.json();
        const table = payload.table;
        const row = payload.record;
        if (!row) return new Response("no record", { status: 200 });

        let push: { userId: string; title: string; body: string; tag: string } | null = null;
        if (table === "bubbles_notifications") push = await buildPushForNotification(row);
        else if (table === "messages") push = await buildPushForMessage(row);
        else if (table === "call_invites") push = await buildPushForCallInvite(row);
        if (!push) return new Response("unhandled table", { status: 200 });

        const subs = await db(`push_subscriptions?user_id=eq.${push.userId}&select=id,endpoint,p256dh,auth`);
        if (!Array.isArray(subs) || !subs.length) return new Response("no subscriptions", { status: 200 });

        const payloadJson = JSON.stringify({ title: push.title, body: push.body, tag: push.tag });

        await Promise.all(subs.map(async (sub: any) => {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payloadJson
                );
            } catch (err: any) {
                // 404/410 means the browser/OS invalidated this subscription
                // (uninstalled, permission revoked, etc.) — clean it up so
                // future pushes don't keep wasting time on a dead endpoint.
                if (err?.statusCode === 404 || err?.statusCode === 410) {
                    await db(`push_subscriptions?id=eq.${sub.id}`, { method: "DELETE" });
                } else {
                    console.error("push send failed:", err?.statusCode, err?.body || err);
                }
            }
        }));

        return new Response("ok", { status: 200 });
    } catch (error) {
        console.error(error);
        return new Response("error", { status: 500 });
    }
});
