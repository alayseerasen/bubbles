/* ============================================================
   BUBBLES — Service Worker
   ------------------------------------------------------------
   Two jobs:
     1) Make the site installable as a PWA (a service worker being
        registered is one of the browser's requirements for the
        "install app" prompt).
     2) Receive Web Push events from the browser even when the tab
        isn't open, and show a system notification for them. Tapping
        that notification focuses an existing Bubbles tab if there is
        one, or opens a new one, and lands on the right page.

   This deliberately does NOT do offline caching of the app itself —
   Bubbles talks to Supabase live and isn't meant to work offline, so
   there's no app-shell cache here to keep stale.
   ============================================================ */

self.addEventListener("install", (event) => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (e) {
        payload = { title: "Bubbles", body: event.data ? event.data.text() : "" };
    }

    const title = payload.title || "Bubbles";
    const options = {
        body: payload.body || "",
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        tag: payload.tag || undefined, // same tag replaces instead of stacking, e.g. multiple messages from the same person
        renotify: !!payload.tag,
        data: { url: payload.url || "./index.html" }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || "./index.html";

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                // Already have a Bubbles tab open — just focus it. We can't
                // navigate it to the exact sub-page (it's a client-routed
                // SPA, not real URLs), but focusing gets them back into the
                // app, which is the part that actually matters.
                if ("focus" in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        })
    );
});
