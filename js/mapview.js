// Térkép-réteg: MapLibre GL vektoros térkép (OpenFreeMap), sötét mód, tartalék raszter térkép,
// útvonal-rajzolás, jelölők. Az app.js csak ezen keresztül beszél a térképpel.
const MapView = (() => {
  const C = window.UTHIRNOK_CONFIG;
  const STYLE_URL = C.MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";
  const FALLBACK_TILES = C.FALLBACK_TILES || ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];

  let map, dark = false, baseStyle = null, usingFallback = false;
  let readyCbs = [], styleReady = false;
  let routeData = { main: [], alts: [], stops: [] };
  let tileOk = false, tileErrors = 0;
  const errorEl = () => document.getElementById("mapError");

  // ---------- színek a sötét módhoz ----------
  function parseColor(s) {
    if (typeof s !== "string") return null;
    s = s.trim();
    let m;
    if ((m = s.match(/^#([0-9a-f]{3,8})$/i))) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join("");
      const n = parseInt(h.slice(0, 6), 16);
      return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
    }
    if ((m = s.match(/^rgba?\(([^)]+)\)$/i))) {
      const p = m[1].split(",").map(x => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
    }
    if ((m = s.match(/^hsla?\(([^)]+)\)$/i))) {
      const p = m[1].split(",").map(x => parseFloat(x));
      const [r, g, b] = hsl2rgb(p[0] / 360, p[1] / 100, p[2] / 100);
      return { r, g, b, a: p[3] ?? 1 };
    }
    return null;
  }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hsl2rgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  function darken(str, kind) {
    const c = parseColor(str); if (!c) return str;
    let [h, s, l] = rgb2hsl(c.r, c.g, c.b);
    if (kind === "text") l = 0.92 - l * 0.45;
    else if (kind === "halo") l = 0.08 + l * 0.04;
    else l = 0.09 + (1 - l) * 0.3;
    s *= kind === "text" ? 0.3 : 0.35;
    const [r, g, b] = hsl2rgb(h, s, Math.max(0, Math.min(1, l)));
    return `rgba(${r | 0},${g | 0},${b | 0},${c.a})`;
  }
  function walk(v, kind) {
    if (typeof v === "string") return darken(v, kind);
    if (Array.isArray(v)) return v.map(x => walk(x, kind));
    if (v && typeof v === "object" && Array.isArray(v.stops)) return { ...v, stops: v.stops.map(([z, c]) => [z, walk(c, kind)]) };
    return v;
  }
  function darkStyle(style) {
    const s = JSON.parse(JSON.stringify(style));
    for (const layer of s.layers) {
      const p = layer.paint; if (!p) continue;
      for (const k of Object.keys(p)) {
        if (!k.endsWith("color")) continue;
        const kind = k === "text-color" ? "text" : k === "text-halo-color" || k === "icon-halo-color" ? "halo" : "fill";
        p[k] = walk(p[k], kind);
      }
      if (layer.type === "symbol" && layer.layout?.["icon-image"] && /poi|amenity|shop/.test(layer.id)) p["icon-opacity"] = 0.75;
    }
    return s;
  }

  function fallbackStyle() {
    return {
      version: 8,
      sources: { osm: { type: "raster", tiles: FALLBACK_TILES, tileSize: 256, maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
      layers: [{ id: "osm", type: "raster", source: "osm",
        paint: dark ? { "raster-brightness-max": 0.55, "raster-saturation": -0.5, "raster-contrast": 0.1 } : {} }],
    };
  }

  async function loadBaseStyle() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    try {
      const res = await fetch(STYLE_URL, { signal: ctl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      baseStyle = await res.json();
      usingFallback = false;
    } catch (e) {
      console.warn("Vektoros térkép nem elérhető, tartalék raszter:", e);
      baseStyle = null; usingFallback = true;
    } finally { clearTimeout(t); }
  }

  function applyStyle() {
    styleReady = false;
    const style = usingFallback ? fallbackStyle() : dark ? darkStyle(baseStyle) : baseStyle;
    map.setStyle(style, { diff: false });
  }

  // ---------- útvonal rétegek ----------
  function addRouteLayers() {
    const fc = f => ({ type: "FeatureCollection", features: f });
    const altF = routeData.alts.map((line, i) => ({ type: "Feature", properties: { i }, geometry: { type: "LineString", coordinates: line.map(p => [p[1], p[0]]) } }));
    const mainF = routeData.main.map(seg => ({ type: "Feature", properties: { color: seg.color }, geometry: { type: "LineString", coordinates: seg.coords.map(p => [p[1], p[0]]) } }));
    const set = (id, data) => { const s = map.getSource(id); if (s) s.setData(data); else map.addSource(id, { type: "geojson", data }); };
    set("route-alt", fc(altF));
    set("route-main", fc(mainF));
    const before = map.getLayer("building-3d") ? "building-3d" : undefined;
    if (!map.getLayer("route-alt")) {
      map.addLayer({ id: "route-alt-casing", type: "line", source: "route-alt", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": dark ? "#0b0e13" : "#7f8b9c", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 14] } }, before);
      map.addLayer({ id: "route-alt", type: "line", source: "route-alt", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": dark ? "#4b5567" : "#aab4c3", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 10] } }, before);
      map.addLayer({ id: "route-casing", type: "line", source: "route-main", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": dark ? "#021a33" : "#0457b8", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 7, 16, 16, 19, 30] } }, before);
      map.addLayer({ id: "route-line", type: "line", source: "route-main", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4.5, 16, 11, 19, 22] } }, before);
      map.on("click", "route-alt", e => { const i = e.features?.[0]?.properties?.i; if (i != null) emit("altclick", i); });
      map.on("mouseenter", "route-alt", () => map.getCanvas().style.cursor = "pointer");
      map.on("mouseleave", "route-alt", () => map.getCanvas().style.cursor = "");
    }
  }

  // ---------- események ----------
  const handlers = {};
  const emit = (n, ...a) => (handlers[n] || []).forEach(f => f(...a));
  const on = (n, f) => (handlers[n] = handlers[n] || []).push(f);

  function showError(msg) {
    const el = errorEl(); if (!el) return;
    document.getElementById("mapErrorText").textContent = msg;
    el.classList.remove("hidden");
  }
  function hideError() { errorEl()?.classList.add("hidden"); }

  async function init(container, { center, zoom, dark: d }) {
    dark = !!d;
    map = new maplibregl.Map({
      container, center: [center[1], center[0]], zoom, attributionControl: { compact: true },
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": dark ? "#0d1117" : "#eef1f4" } }] },
      maxPitch: 70, dragRotate: true, pitchWithRotate: true, fadeDuration: 150,
    });
    map.touchZoomRotate.enableRotation();
    map.on("style.load", () => { styleReady = true; addRouteLayers(); emit("styleload"); readyCbs.splice(0).forEach(f => f()); });
    map.on("data", e => { if (e.dataType === "source" && e.tile && e.isSourceLoaded !== undefined) { tileOk = true; hideError(); } });
    map.on("sourcedata", e => { if (e.tile) { tileOk = true; hideError(); } });
    map.on("error", e => {
      const msg = String(e?.error?.message || e?.error || "");
      if (/tile|pbf|png|Failed to fetch|NetworkError|40\d|50\d/i.test(msg)) tileErrors++;
      console.warn("Térkép hiba:", msg);
      if (!tileOk && tileErrors >= 6) {
        if (!usingFallback) { usingFallback = true; tileErrors = 0; applyStyle(); }
        else showError("Nem érem el a térképszervert. Ellenőrizd az internetet, vagy próbáld újra.");
      }
    });
    map.on("contextmenu", e => emit("contextmenu", [e.lngLat.lat, e.lngLat.lng], e.point));
    map.on("dragstart", () => emit("userpan"));
    map.on("rotatestart", e => { if (e.originalEvent) emit("userpan"); });
    map.on("moveend", () => emit("moveend"));
    // hosszú nyomás telefonon
    let lp;
    map.on("touchstart", e => { if (e.points?.length !== 1) return; clearTimeout(lp); lp = setTimeout(() => emit("contextmenu", [e.lngLat.lat, e.lngLat.lng], e.point), 550); });
    ["touchend", "touchmove", "touchcancel", "dragstart"].forEach(n => map.on(n, () => clearTimeout(lp)));

    document.getElementById("mapRetry")?.addEventListener("click", async () => { hideError(); tileErrors = 0; tileOk = false; await loadBaseStyle(); applyStyle(); });

    await loadBaseStyle();
    applyStyle();
    // ha 15 mp alatt egy csempe sem jött le, szóljunk
    setTimeout(() => { if (!tileOk) { if (!usingFallback) { usingFallback = true; applyStyle(); setTimeout(() => { if (!tileOk) showError("Nem érem el a térképszervert. Ellenőrizd az internetet."); }, 10000); } else showError("Nem érem el a térképszervert. Ellenőrizd az internetet."); } }, 15000);
    return map;
  }

  function setDark(d) {
    if (!!d === dark) return;
    dark = !!d;
    if (map) applyStyle();
  }

  function setRoute(mainSegments, alts = []) {
    routeData.main = mainSegments; routeData.alts = alts;
    if (styleReady) addRouteLayers();
  }
  const clearRoute = () => setRoute([], []);

  const toLngLat = p => [p[1], p[0]];
  function marker(pos, el, opts = {}) {
    return new maplibregl.Marker({ element: el, anchor: opts.anchor || "bottom", rotationAlignment: opts.rotationAlignment || "viewport", pitchAlignment: opts.pitchAlignment || "viewport", offset: opts.offset })
      .setLngLat(toLngLat(pos)).addTo(map);
  }
  function popup(pos, html, opts = {}) {
    return new maplibregl.Popup({ closeButton: true, maxWidth: "300px", offset: opts.offset ?? 14, className: "pp" })
      .setLngLat(toLngLat(pos)).setHTML(html).addTo(map);
  }
  function fit(points, pad) {
    if (!points.length) return;
    let s = 90, w = 180, n = -90, e = -180;
    for (const [la, lo] of points) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
    map.fitBounds([[w, s], [e, n]], { padding: pad, bearing: 0, pitch: 0, duration: 700, maxZoom: 16 });
  }
  function bounds(pad = 0) {
    const b = map.getBounds();
    const dl = (b.getNorth() - b.getSouth()) * pad, dw = (b.getEast() - b.getWest()) * pad;
    return { s: b.getSouth() - dl, w: b.getWest() - dw, n: b.getNorth() + dl, e: b.getEast() + dw };
  }
  const center = () => { const c = map.getCenter(); return [c.lat, c.lng]; };

  // követés: navigációban menetirányba fordított, döntött nézet
  function follow(pos, heading, nav, speedKmh) {
    if (nav) {
      const zoom = speedKmh > 90 ? 15.2 : speedKmh > 50 ? 16.2 : 17;
      map.easeTo({ center: toLngLat(pos), bearing: heading ?? map.getBearing(), pitch: 58, zoom, duration: 900, easing: t => t,
        padding: { top: window.innerHeight * 0.35, bottom: 0, left: 0, right: 0 } });
    } else {
      map.easeTo({ center: toLngLat(pos), zoom: Math.max(map.getZoom(), 15), duration: 600, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    }
  }
  function resetView() { map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 }); }

  return {
    init, setDark, setRoute, clearRoute, marker, popup, fit, bounds, center, follow, resetView, on,
    get map() { return map; }, get usingFallback() { return usingFallback; },
    onReady: f => styleReady ? f() : readyCbs.push(f),
  };
})();
