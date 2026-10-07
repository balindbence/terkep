// OpenStreetMap adatok (Overpass): fix traffipaxok, benzinkutak, parkolók, sebességkorlát
const Pois = (() => {
  const C = window.UTHIRNOK_CONFIG;
  const FUELS = [["95", "95 benzin"], ["100", "100 benzin"], ["diesel", "Dízel"], ["lpg", "LPG"]];
  let fetched = [];          // már lekért területek [{s,w,n,e,kinds}]
  const cache = { camera: new Map(), fuel: new Map(), parking: new Map() };
  let busy = false;

  const contains = (a, b) => a.s <= b.s && a.w <= b.w && a.n >= b.n && a.e >= b.e;

  async function overpass(q) {
    const res = await fetch(C.OVERPASS_URL, { method: "POST", body: "data=" + encodeURIComponent(q),
      headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    if (!res.ok) throw new Error("Overpass " + res.status);
    return res.json();
  }

  // lekéri a nézet POI-jait (kinds: ["camera","fuel","parking"])
  async function load(b, kinds) {
    kinds = kinds.filter(k => !fetched.some(f => f.kinds.includes(k) && contains(f, b)));
    if (!kinds.length || busy) return false;
    // kicsit nagyobb területet kérünk, hogy mozgatáskor ne kelljen azonnal újra
    const pad = Math.max(b.n - b.s, b.e - b.w) * 0.5;
    const B = { s: b.s - pad, w: b.w - pad, n: b.n + pad, e: b.e + pad };
    const bb = `(${B.s.toFixed(4)},${B.w.toFixed(4)},${B.n.toFixed(4)},${B.e.toFixed(4)})`;
    const parts = [];
    if (kinds.includes("camera")) parts.push(`node["highway"="speed_camera"]${bb};`);
    if (kinds.includes("fuel")) parts.push(`nwr["amenity"="fuel"]${bb};`);
    if (kinds.includes("parking")) parts.push(`nwr["amenity"="parking"]["access"!~"private|no|customers"]${bb};`);
    busy = true;
    try {
      const data = await overpass(`[out:json][timeout:25];(${parts.join("")});out center tags 1500;`);
      for (const el of data.elements) {
        const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
        if (lat == null) continue;
        const t = el.tags || {};
        const id = `${el.type[0]}${el.id}`;
        const p = { id, lat, lng, tags: t };
        if (t.highway === "speed_camera") cache.camera.set(id, p);
        else if (t.amenity === "fuel") cache.fuel.set(id, p);
        else if (t.amenity === "parking") cache.parking.set(id, p);
      }
      fetched.push({ ...B, kinds });
      if (fetched.length > 30) fetched = fetched.slice(-30);
      return true;
    } finally { busy = false; }
  }

  const inView = (map, b) => [...map.values()].filter(p => p.lat >= b.s && p.lat <= b.n && p.lng >= b.w && p.lng <= b.e);

  // ----- sebességkorlát -----
  const IMPLIED = { "hu:urban": 50, "hu:rural": 90, "hu:motorway": 130, "hu:trunk": 110, "hu:expressway": 110, "hu:living_street": 20, "walk": 10 };
  const BY_CLASS = { motorway: 130, motorway_link: 80, trunk: 110, trunk_link: 70 };
  let lastLimitAt = 0, lastLimitPos = null, lastLimit = null;

  function parseSpeed(v) {
    if (!v) return null;
    const k = String(v).toLowerCase();
    if (IMPLIED[k]) return IMPLIED[k];
    const n = parseInt(k, 10);
    return isNaN(n) ? null : (k.includes("mph") ? Math.round(n * 1.609) : n);
  }

  async function speedLimit(pos, heading) {
    const now = Date.now();
    if (lastLimitPos && Geo.dist(pos, lastLimitPos) < 120 && now - lastLimitAt < 30000) return lastLimit;
    if (now - lastLimitAt < 6000) return lastLimit;
    lastLimitAt = now; lastLimitPos = pos;
    try {
      const q = `[out:json][timeout:10];way(around:18,${pos[0]},${pos[1]})["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|_link"];out tags geom 6;`;
      const data = await overpass(q);
      let best = null, bestScore = Infinity;
      for (const w of data.elements) {
        // az úthoz képest legjobban illeszkedő irányú szakaszt választjuk
        let score = 0;
        if (heading != null && w.geometry?.length > 1) {
          const g = w.geometry.map(p => [p.lat, p.lon]);
          const n = Geo.nearestOnLine(pos, g);
          const br = Geo.bearing(g[n.i], g[n.i + 1] || g[n.i]);
          score = Math.min(Geo.angleDiff(br, heading), Geo.angleDiff((br + 180) % 360, heading)) + n.d;
        }
        if (score < bestScore) { bestScore = score; best = w; }
      }
      const t = best?.tags || {};
      lastLimit = parseSpeed(t.maxspeed) ?? parseSpeed(t["maxspeed:forward"]) ?? parseSpeed(t["source:maxspeed"] || t["zone:maxspeed"]) ?? BY_CLASS[t.highway] ?? null;
    } catch { /* hálózati hiba: marad az előző */ }
    return lastLimit;
  }

  return { FUELS, cache, load, inView, speedLimit };
})();
