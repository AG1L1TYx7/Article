/*
 * The push service worker. Registered by components/push/PushToggle.tsx
 * the moment a reader turns alerts on, and by nothing else: this site
 * does no offline caching, so the worker's only job is to receive pushes
 * and show them. Keeping it this small means there is nothing here to go
 * stale between deployments.
 *
 * The payload is the JSON from src/lib/pushPayload.ts.
 */

self.addEventListener("install", () => {
  // Take over from any previous version at once rather than waiting for
  // every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "The Dispatch", body: "", url: "/", tag: undefined };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch {
    // A payload that is not JSON is shown as plain text rather than dropped.
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      // A repeat with the same tag replaces the earlier one silently.
      renotify: false,
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse a tab that already has the site open rather than piling
      // up windows.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

/*
 * Browsers occasionally rotate a subscription on their own. Without this
 * the server would keep posting to an endpoint that no longer exists and
 * the reader would silently stop receiving alerts.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const resubscribe = self.registration.pushManager
    .subscribe(event.oldSubscription?.options ?? { userVisibleOnly: true })
    .then((subscription) =>
      fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      })
    )
    .catch(() => {});
  event.waitUntil(resubscribe);
});
