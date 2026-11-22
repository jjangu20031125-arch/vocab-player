// Service worker: lets the site install as an app and opens books offline.
// API calls and YouTube always go to the network.
const VERSION = 'vp-1';
const SHELL = ['/', '/index.html', '/app.js', '/style.css', '/manifest.webmanifest',
  '/vendor/ts-fsrs.min.mjs', '/vendor/jszip.min.js', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const c = await caches.open(VERSION);
  try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
  catch (e) { return (await c.match(req, { ignoreSearch: true })) || (await c.match('/index.html')) || Response.error(); }
}
async function cacheFirst(req) {
  const c = await caches.open(VERSION);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // Book chapters, dictionary, libraries and icons never change once published.
  if (/^\/data\/(books\/[^/]+\/|dict\/)|^\/vendor\/|^\/icons\//.test(u.pathname)) { e.respondWith(cacheFirst(req)); return; }
  // Page, code and the video/book lists: newest when online, saved copy when offline.
  e.respondWith(networkFirst(req));
});
