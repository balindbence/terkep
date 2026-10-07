// Útvonaltervezés (OSRM) + magyar navigációs utasítások, sávjelzés, nyilak
const Routing = (() => {
  const C = window.UTHIRNOK_CONFIG;

  // nyíl-ikonok (SVG path, 48x48)
  const ARROWS = {
    straight: '<path d="M24 42V8M13 18L24 7l11 11"/>',
    left: '<path d="M30 42V24a6 6 0 00-6-6H10M18 10l-8 8 8 8"/>',
    right: '<path d="M18 42V24a6 6 0 016-6h14M30 10l8 8-8 8"/>',
    "slight left": '<path d="M28 42V28L16 14M14 24V12h12"/>',
    "slight right": '<path d="M20 42V28l12-14M34 24V12H22"/>',
    "sharp left": '<path d="M30 8v20L12 40M10 28v14h14"/>',
    "sharp right": '<path d="M18 8v20l18 12M38 28v14H24"/>',
    uturn: '<path d="M16 42V20a8 8 0 0116 0v12M24 26l8 8 8-8"/>',
    roundabout: '<path d="M24 44V33a9 9 0 1 0-9-9"/><path d="M10 19l5 5 5-5"/>',
    arrive: '<path d="M14 42V7M14 8h20l-5 7 5 7H14"/>',
    depart: '<path d="M24 42V8M13 18L24 7l11 11"/>',
  };
  // a felvett hangcsomag mondat-azonosítója egy lépéshez
  const ARROW_KEY = { left: "turn_left", right: "turn_right", "slight left": "keep_left", "slight right": "keep_right",
    "sharp left": "sharp_left", "sharp right": "sharp_right", uturn: "uturn", straight: "straight" };
  function keyOf(st) {
    if (st.type === "arrive") return st.text === "Megálló" ? "arrive_stop" : "arrive_soon";
    if (st.arrow === "roundabout") return st.exit && st.exit <= 5 ? "rb_" + st.exit : "rb";
    if (/^Felhajtó/.test(st.text)) return st.arrow.includes("left") ? "ramp_left" : "ramp_right";
    if (/^Lehajtó/.test(st.text)) return st.arrow.includes("left") ? "exit_left" : "exit_right";
    if (/^Sorolj/.test(st.text)) return "merge";
    if (st.type === "depart") return null;
    return ARROW_KEY[st.arrow] || "straight";
  }
  const svgArrow = (k, size = 46) => `<svg viewBox="0 0 48 48" style="width:${size}px;height:${size}px">${ARROWS[k] || ARROWS.straight}</svg>`;

  const ORD = ["", "első", "második", "harmadik", "negyedik", "ötödik", "hatodik", "hetedik", "nyolcadik"];
  const TURN = { "uturn": "Fordulj vissza", "sharp right": "Fordulj élesen jobbra", "right": "Fordulj jobbra", "slight right": "Tarts enyhén jobbra",
    "straight": "Haladj egyenesen", "slight left": "Tarts enyhén balra", "left": "Fordulj balra", "sharp left": "Fordulj élesen balra" };

  function instruction(s) {
    const m = s.maneuver, mod = m.modifier || "straight";
    const side = mod.includes("left") ? "balra" : mod.includes("right") ? "jobbra" : "egyenesen";
    const turn = TURN[mod] || TURN.straight;
    switch (m.type) {
      case "depart": return { text: "Indulj el", arrow: "depart" };
      case "arrive": return { text: "Úti cél", say: "megérkezel", arrow: "arrive" };
      case "roundabout": case "rotary": case "roundabout turn":
        return { exit: m.exit, text: m.exit ? `Körforgalom, ${ORD[m.exit] || m.exit + "."} kijárat` : "Hajts be a körforgalomba",
                 say: m.exit ? `a körforgalomból hajts ki a ${ORD[m.exit] || m.exit + "."} kijáraton` : "hajts be a körforgalomba", arrow: "roundabout" };
      case "exit roundabout": case "exit rotary": return { text: "Hajts ki a körforgalomból", arrow: mod };
      case "merge": return { text: `Sorolj be ${side}`, arrow: mod };
      case "on ramp": return { text: `Felhajtó ${side}`, say: `hajts fel a felhajtón ${side}`, arrow: mod };
      case "off ramp": return { text: `Lehajtó ${side}`, say: `hajts le a lehajtón ${side}`, arrow: mod };
      case "fork": return { text: `Elágazásnál tarts ${side}`, arrow: mod };
      case "end of road": return { text: `Az út végén ${side}`, say: `az út végén fordulj ${side}`, arrow: mod };
      case "continue": case "new name": return { text: mod === "straight" ? "Haladj tovább" : turn, arrow: mod };
      default: return { text: turn, arrow: mod };
    }
  }

  // sávok: [{arrow, on}] — csak ha legalább 2 sáv van és van köztük nem érvényes
  function lanesOf(step) {
    const lanes = step.intersections?.[0]?.lanes;
    if (!lanes || lanes.length < 2 || lanes.every(l => l.valid)) return null;
    return lanes.map(l => {
      const ind = (l.indications || ["straight"]).filter(i => i !== "none");
      const pick = l.valid ? (ind.find(i => i === step.maneuver.modifier) || ind[0]) : ind[0];
      return { arrow: pick || "straight", on: !!l.valid };
    });
  }

  // ===================== Valhalla (elsődleges) =====================
  // Tudja: földutak kizárása, fizetős/autópálya kerülése, sok megálló, sorrend-optimalizálás.
  const VH = () => (C.VALHALLA_URL || "https://valhalla1.openstreetmap.de").replace(/\/$/, "");
  const MAX_LOC = 20;   // a nyilvános szerver korlátja egy kérésben; fölötte szakaszokra bontjuk

  function decode6(str) {
    const out = []; let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
        const d = res & 1 ? ~(res >> 1) : res >> 1;
        if (k === 0) lat += d; else lng += d;
      }
      out.push([lat / 1e6, lng / 1e6]);
    }
    return out;
  }

  const VTYPE = {
    7: "straight", 8: "straight", 22: "straight", 9: "slight right", 10: "right", 11: "sharp right", 12: "uturn", 13: "uturn",
    14: "sharp left", 15: "left", 16: "slight left", 17: "straight", 18: "slight right", 19: "slight left", 20: "slight right",
    21: "slight left", 23: "slight right", 24: "slight left", 25: "straight", 37: "slight right", 38: "slight left",
  };
  function vInstruction(m, isLastLeg) {
    const t = m.type, arrow = VTYPE[t] || "straight";
    const side = arrow.includes("left") ? "balra" : arrow.includes("right") ? "jobbra" : "egyenesen";
    if (t >= 1 && t <= 3) return { text: "Indulj el", arrow: "depart", type: "depart" };
    if (t >= 4 && t <= 6) return isLastLeg ? { text: "Úti cél", say: "megérkezel", arrow: "arrive", type: "arrive" }
                                           : { text: "Megálló", say: "megérkezel a megállóhoz", arrow: "arrive", type: "arrive" };
    if (t === 26) { const n = m.roundabout_exit_count; return { exit: n, text: n ? `Körforgalom, ${ORD[n] || n + "."} kijárat` : "Hajts be a körforgalomba",
      say: n ? `a körforgalomból hajts ki a ${ORD[n] || n + "."} kijáraton` : "hajts be a körforgalomba", arrow: "roundabout", type: "roundabout" }; }
    if (t === 27) return { text: "Hajts ki a körforgalomból", arrow: "slight right", type: "exit roundabout", quiet: true };
    if (t === 17 || t === 18 || t === 19) return { text: `Felhajtó ${side}`, say: `hajts fel a felhajtón ${side}`, arrow };
    if (t === 20 || t === 21) return { text: `Lehajtó ${side}`, say: `hajts le a lehajtón ${side}`, arrow };
    if (t === 23 || t === 24) return { text: `Tarts ${side}`, arrow };
    if (t === 25 || t === 37 || t === 38) return { text: "Sorolj be", arrow };
    if (t === 28) return { text: "Hajts fel a kompra", arrow: "straight" };
    if (t === 29) return { text: "Hajts le a kompról", arrow: "straight" };
    if (t === 7 || t === 8 || t === 22) return { text: "Haladj tovább", arrow };
    return { text: TURN[arrow] || TURN.straight, arrow };
  }

  async function valhalla(points, o, alternatives) {
    const body = {
      locations: points.map((p, i) => ({ lat: +p[0].toFixed(6), lon: +p[1].toFixed(6), type: i === 0 || i === points.length - 1 ? "break" : "break" })),
      costing: "auto",
      costing_options: { auto: { exclude_unpaved: !!o.avoidUnpaved, use_tolls: o.avoidTolls ? 0 : 0.5, use_highways: o.avoidMotorways ? 0 : 1 } },
      units: "kilometers", directions_options: { language: "hu-HU" },
      ...(alternatives && points.length === 2 ? { alternates: 2 } : {}),
    };
    const res = await fetch(`${VH()}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.trip) {
      const e = new Error(data.error_code === 442 || /no path|No route/i.test(data.error || "") ? "Ide nem találtam autós útvonalat." : "Valhalla " + res.status);
      e.noRoute = /útvonalat/.test(e.message); throw e;
    }
    return [data.trip, ...(data.alternates || []).map(a => a.trip)].map(vPrepare);
  }

  function vPrepare(trip) {
    const line = [], steps = [];
    const offsets = [];
    trip.legs.forEach((leg, li) => {
      const shp = decode6(leg.shape);
      offsets.push(line.length ? line.length - 1 : 0);
      line.push(...(line.length ? shp.slice(1) : shp));
    });
    const cum = Geo.cumulative(line);
    const roads = [];
    trip.legs.forEach((leg, li) => {
      const off = offsets[li], last = li === trip.legs.length - 1;
      leg.maneuvers.forEach((m, mi) => {
        if (li > 0 && mi === 0) return;    // a következő szakasz "indulj el" lépése felesleges
        const idx = Math.min(off + m.begin_shape_index, line.length - 1);
        const ins = vInstruction(m, last);
        if (ins.quiet) return;
        const name = (m.begin_street_names || m.street_names || [])[0] || "";
        if (m.length > 1.5 && m.street_names?.length) roads.push(m.street_names.find(n => /^\d+$|^M\d/.test(n)) || m.street_names[0]);
        const st = { loc: line[idx], along: cum[idx], name: ins.type === "roundabout" ? "" : name, lanes: null, type: ins.type || "turn", ...ins };
        st.key = keyOf(st); steps.push(st);
      });
    });
    return { line, cum, steps, distance: trip.summary.length * 1000, duration: trip.summary.time, roads: [...new Set(roads)].slice(0, 2), engine: "valhalla" };
  }

  // sok megálló: MAX_LOC-onként külön kérés, majd összefűzés
  function merge(parts) {
    if (parts.length === 1) return parts[0];
    const line = [], steps = []; let distance = 0, duration = 0; const roads = [];
    for (const [i, p] of parts.entries()) {
      const base = line.length ? Geo.cumulative(line).pop() : 0;
      line.push(...(line.length ? p.line.slice(1) : p.line));
      p.steps.forEach((s, k) => { if (i > 0 && k === 0) return; if (i < parts.length - 1 && s.type === "arrive" && k === p.steps.length - 1) s = { ...s, text: "Megálló", say: "megérkezel a megállóhoz", key: "arrive_stop" }; steps.push({ ...s, along: s.along + base }); });
      distance += p.distance; duration += p.duration; roads.push(...p.roads);
    }
    return { line, cum: Geo.cumulative(line), steps, distance, duration, roads: [...new Set(roads)].slice(0, 2), engine: parts[0].engine };
  }

  async function route(points, o = {}) {
    const alternatives = o.alternatives !== false;
    let lastErr;
    // 1) Valhalla
    try {
      if (points.length <= MAX_LOC) return await valhalla(points, o, alternatives);
      const parts = [];
      for (let i = 0; i < points.length - 1; i += MAX_LOC - 1) parts.push((await valhalla(points.slice(i, i + MAX_LOC), o, false))[0]);
      return [merge(parts)];
    } catch (e) { lastErr = e; if (e.noRoute && o.avoidUnpaved) throw new Error("Földutak nélkül nem találtam útvonalat. Kapcsold ki a „Földút nélkül” opciót."); }
    // 2) OSRM tartalék (nem tud földutat kizárni, de van sávinformáció)
    console.warn("Valhalla nem elérhető, OSRM tartalék:", lastErr);
    const parts = [];
    for (let i = 0; i < points.length - 1; i += 99) parts.push(...(await osrm(points.slice(i, i + 100), o, alternatives && points.length === 2)));
    const r = points.length <= 100 ? parts : [merge(parts)];
    r.forEach(x => { x.engine = "osrm"; });
    return r;
  }

  // sorrend optimalizálása (az első és az utolsó pont marad)
  async function optimize(points) {
    const res = await fetch(`${VH()}/optimized_route`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations: points.map(p => ({ lat: p[0], lon: p[1] })), costing: "auto" }) });
    const data = await res.json();
    if (!data.trip) throw new Error("Most nem sikerült optimalizálni.");
    return data.trip.locations.map(l => l.original_index);
  }

  // ===================== OSRM (tartalék) =====================
  async function osrm(points, { avoidTolls = false, avoidMotorways = false } = {}, alternatives) {
    const pts = points.map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(";");
    const ex = [avoidTolls && "toll", avoidMotorways && "motorway"].filter(Boolean).join(",");
    const base = `${C.OSRM_URL}/route/v1/driving/${pts}?overview=full&geometries=geojson&steps=true&alternatives=${alternatives ? "3" : "false"}`;
    let res;
    try {
      res = await fetch(base + (ex ? `&exclude=${ex}` : ""));
      if (!res.ok && ex) res = await fetch(base);
    } catch { throw new Error("Nem érem el az útvonaltervezőt. Van internet?"); }
    if (!res.ok) throw new Error("Az útvonaltervező most nem válaszol (" + res.status + "). Próbáld újra pár másodperc múlva.");
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) throw new Error("Ide nem találtam autós útvonalat.");
    return data.routes.map(prepare);
  }

  function prepare(r) {
    const line = r.geometry.coordinates.map(c => [c[1], c[0]]);
    const cum = Geo.cumulative(line);
    const steps = [];
    let from = 0;
    r.legs.forEach((leg, li) => leg.steps.forEach(s => {
      const loc = [s.maneuver.location[1], s.maneuver.location[0]];
      const n = Geo.nearestOnLine(loc, line, from);
      from = n.i;
      const along = cum[n.i] + ((cum[n.i + 1] ?? cum[n.i]) - cum[n.i]) * n.t;
      const ins = instruction(s);
      if (s.maneuver.type === "arrive" && li < r.legs.length - 1) { ins.text = "Megálló"; ins.say = "megérkezel a megállóhoz"; }
      const st = { loc, along, name: s.name || s.ref || "", ...ins, type: s.maneuver.type, lanes: lanesOf(s) };
      st.key = keyOf(st); steps.push(st);
    }));
    const roads = [...new Set(r.legs.flatMap(l => l.steps).filter(s => s.distance > 1500 && (s.ref || s.name)).map(s => s.ref || s.name))].slice(0, 2);
    return { line, cum, steps, distance: r.distance, duration: r.duration, roads };
  }

  function progress(rt, pos, hintIdx = 0) {
    const from = Math.max(0, hintIdx - 30);
    let n = Geo.nearestOnLine(pos, rt.line, from, Math.min(rt.line.length - 1, hintIdx + 400));
    if (n.d > 80) n = Geo.nearestOnLine(pos, rt.line);
    const along = rt.cum[n.i] + ((rt.cum[n.i + 1] ?? rt.cum[n.i]) - rt.cum[n.i]) * n.t;
    return { off: n.d, idx: n.i, along };
  }

  // a vonallánc egy szakasza [a, b] méter között
  function slice(rt, a, b) {
    const out = [];
    for (let i = 0; i < rt.line.length - 1; i++) {
      const s = rt.cum[i], e = rt.cum[i + 1];
      if (e < a || s > b) continue;
      const lerp = d => { const t = (d - s) / ((e - s) || 1); return [rt.line[i][0] + (rt.line[i + 1][0] - rt.line[i][0]) * t, rt.line[i][1] + (rt.line[i + 1][1] - rt.line[i][1]) * t]; };
      if (!out.length) out.push(s >= a ? rt.line[i] : lerp(a));
      out.push(e <= b ? rt.line[i + 1] : lerp(b));
    }
    return out;
  }

  return { route, optimize, progress, slice, svgArrow, _decode6: decode6 };
})();
