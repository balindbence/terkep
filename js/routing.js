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
    roundabout: '<circle cx="24" cy="20" r="8"/><path d="M24 42V28M31 15l7-7M30 8h8v8"/>',
    arrive: '<path d="M14 42V7M14 8h20l-5 7 5 7H14"/>',
    depart: '<path d="M24 42V8M13 18L24 7l11 11"/>',
  };
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
        return { text: m.exit ? `Körforgalom, ${ORD[m.exit] || m.exit + "."} kijárat` : "Hajts be a körforgalomba",
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

  async function route(points, { avoidTolls = false, avoidMotorways = false, alternatives = true } = {}) {
    const pts = points.map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(";");
    const ex = [avoidTolls && "toll", avoidMotorways && "motorway"].filter(Boolean).join(",");
    const alt = alternatives && points.length === 2 ? "3" : "false";
    const base = `${C.OSRM_URL}/route/v1/driving/${pts}?overview=full&geometries=geojson&steps=true&alternatives=${alt}`;
    let res;
    try {
      res = await fetch(base + (ex ? `&exclude=${ex}` : ""));
      if (!res.ok && ex) res = await fetch(base);   // ha a szerver nem támogatja a kizárást
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
      steps.push({ loc, along, name: s.name || s.ref || "", ...ins, type: s.maneuver.type, lanes: lanesOf(s) });
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

  return { route, progress, slice, svgArrow };
})();
