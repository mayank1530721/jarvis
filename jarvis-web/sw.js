// Keeps the Jarvis page available offline.
// Online: always fetch the newest file and refresh the saved copy. Offline: use the saved copy.
const CACHE = "jarvis-page-v28";
const SHELL = [
  "./", "./index.html", "./css/theme.css", "./css/app.css",
  "./js/util.js", "./js/agents.js", "./js/intent.js", "./js/council.js", "./js/uplika.js", "./js/github.js", "./js/hands.js", "./js/research.js", "./js/vault.js", "./js/voice.js", "./js/model.js", "./js/cores.js", "./js/app.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;  // never touch API calls
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }   // never save an error page
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});
