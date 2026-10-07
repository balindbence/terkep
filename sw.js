// Úthírnök service worker: app-héj offline, térképcsempék gyorsítótárban
const VER = "uthirnok-v4";
const SHELL = ["./", "index.html", "style.css", "config.js", "manifest.webmanifest",
  "js/version.js", "js/geo.js", "js/store.js", "js/reports.js", "js/routing.js", "js/pois.js", "js/costs.js", "js/voice.js", "js/mapview.js", "js/app.js",
  "icons/icon-192.png", "icons/icon-512.png",
  "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"];
const TILES = "uthirnok-tiles";
const MAX_TILES = 3000;

self.addEventListener("install", e => { e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VER && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES); const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // térképcsempék: gyorsítótár először (offline is látszik, amit már láttál)
  if (url.hostname === "tiles.openfreemap.org" || url.hostname === "tile.openstreetmap.org") {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try { const res = await fetch(e.request); if (res.ok) { c.put(e.request, res.clone()); trimTiles(); } return res; }
      catch { return new Response("", { status: 504 }); }
    }));
    return;
  }
  // API-k (útvonal, keresés, Supabase, Overpass): mindig hálózat
  if (url.origin !== location.origin && !url.hostname.includes("unpkg.com")) return;
  // app-héj: hálózat először, ha nincs net, gyorsítótár
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(VER).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request)));
});
