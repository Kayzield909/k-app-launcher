// App shell only. GitHub API calls (your data) are never touched or cached here.
const VERSION = "cad67df";
const CACHE = "aatrox-" + VERSION;
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/favicon-64.png", "icons/maskable-512.png",
  "v2/", "v2/index.html", "v2/styles.css", "v2/app.js", "v2/chart.js", "icons/badge-96.png",
  "sounds/aatrox-chime.mp3", "sounds/aatrox-warn.mp3"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first so a new deploy shows up on the next open; cached copy when offline.
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});

// ---------- alerts (Web Push from the daily and weekly runs) ----------
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "Aatrox", body: e.data ? e.data.text() : "" }; }
  const url = new URL(d.url || "./#alerts", self.registration.scope).href;
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || "Aatrox", {
      body: d.body || "", tag: d.tag || "aatrox", renotify: true, timestamp: Date.now(),
      icon: "icons/icon-192.png", badge: "icons/badge-96.png",
      vibrate: d.kind === "warn" ? [120, 60, 120, 60, 240] : [40, 30, 40, 30, 160],
      data: { url, kind: d.kind || "info" }
    }),
    // if the app is open, tell it: it refreshes and plays the chime itself
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(cs => cs.forEach(c => c.postMessage({ type: "aatrox-alert", kind: d.kind || "info" })))
  ]));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || new URL("./#alerts", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.focus(); return c.navigate ? c.navigate(url) : null; }
    return self.clients.openWindow(url);
  }));
});
