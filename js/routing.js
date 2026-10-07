// Útvonaltervezés (OSRM) + magyar navigációs utasítások
const Routing = (() => {
  const C = window.UTHIRNOK_CONFIG;

  const DIR = {
    "uturn": ["Fordulj vissza", "↩"], "sharp right": ["Fordulj élesen jobbra", "↱"], "right": ["Fordulj jobbra", "→"],
    "slight right": ["Tarts enyhén jobbra", "↗"], "straight": ["Haladj egyenesen", "↑"], "slight left": ["Tarts enyhén balra", "↖"],
    "left": ["Fordulj balra", "←"], "sharp left": ["Fordulj élesen balra", "↰"],
  };
  const ORD = ["", "első", "második", "harmadik", "negyedik", "ötödik", "hatodik", "hetedik", "nyolcadik"];

  function instruction(s) {
    const m = s.maneuver, mod = m.modifier || "straight";
    const [turnTxt, arrow] = DIR[mod] || DIR.straight;
    const side = mod.includes("left") ? "balra" : mod.includes("right") ? "jobbra" : "egyenesen";
    let text;
    switch (m.type) {
      case "depart": text = "Indulj el"; break;
      case "arrive": return { text: "Úti cél", say: "megérkezel az úti célhoz", arrow: "🏁" };
      case "roundabout": case "rotary":
        text = m.exit ? `A körforgalomból a ${ORD[m.exit] || m.exit + "."} kijáraton hajts ki` : "Hajts be a körforgalomba";
        return { text, arrow: "⟳" };
      case "exit roundabout": case "exit rotary": text = "Hajts ki a körforgalomból"; break;
      case "roundabout turn": text = turnTxt; break;
      case "merge": text = `Sorolj be ${side}`; break;
      case "on ramp": text = `Hajts fel a felhajtón ${side}`; break;
      case "off ramp": text = `Hajts le a lehajtón ${side}`; break;
      case "fork": text = `Az elágazásnál tarts ${side}`; break;
      case "end of road": text = `Az út végén fordulj ${side}`; break;
      case "continue": case "new name": text = mod === "straight" ? "Haladj tovább" : turnTxt; break;
      default: text = turnTxt;
    }
    return { text, arrow };
  }

  async function route(from, to, { avoidTolls = false, avoidMotorways = false, via = [] } = {}) {
    const pts = [from, ...via, to].map(p => `${p[1]},${p[0]}`).join(";");
    const ex = [avoidTolls && "toll", avoidMotorways && "motorway"].filter(Boolean).join(",");
    const base = `${C.OSRM_URL}/route/v1/driving/${pts}?overview=full&geometries=geojson&steps=true&alternatives=${via.length ? "false" : "3"}`;
    let res = await fetch(base + (ex ? `&exclude=${ex}` : ""));
    if (!res.ok && ex) res = await fetch(base);   // ha a szerver nem támogatja a kizárást
    if (!res.ok) throw new Error("Útvonaltervező hiba (" + res.status + ")");
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) throw new Error("Nem találtam útvonalat.");
    return data.routes.map(prepare);
  }

  function prepare(r) {
    const line = r.geometry.coordinates.map(c => [c[1], c[0]]);
    const cum = Geo.cumulative(line);
    const steps = [];
    let from = 0;
    for (const leg of r.legs) for (const s of leg.steps) {
      const loc = [s.maneuver.location[1], s.maneuver.location[0]];
      const n = Geo.nearestOnLine(loc, line, from);
      from = n.i;
      const along = cum[n.i] + (cum[n.i + 1] - cum[n.i] || 0) * n.t;
      const ins = instruction(s);
      steps.push({ loc, along, name: s.name || s.ref || "", ...ins, type: s.maneuver.type, distance: s.distance });
    }
    const roads = [...new Set(r.legs.flatMap(l => l.steps).filter(s => s.distance > 1500 && (s.ref || s.name)).map(s => s.ref || s.name))].slice(0, 3);
    return { line, cum, steps, distance: r.distance, duration: r.duration, roads };
  }

  // hol tartok az útvonalon: távolság a vonaltól, megtett táv
  function progress(rt, pos, hintIdx = 0) {
    const from = Math.max(0, hintIdx - 30);
    let n = Geo.nearestOnLine(pos, rt.line, from, Math.min(rt.line.length - 1, hintIdx + 400));
    if (n.d > 80) n = Geo.nearestOnLine(pos, rt.line);   // teljes keresés, ha elvesztettük
    const along = rt.cum[n.i] + ((rt.cum[n.i + 1] ?? rt.cum[n.i]) - rt.cum[n.i]) * n.t;
    return { off: n.d, idx: n.i, along };
  }

  return { route, progress };
})();
