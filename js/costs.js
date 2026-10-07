// Útköltség + e-matrica figyelő
// Üzemanyag: táv × fogyasztás × ár. Matrica: a Valhalla megmondja, mely szakaszok fizetősek,
// a Nominatim pedig, hogy azok melyik vármegyében vannak.
const Costs = (() => {
  const C = window.UTHIRNOK_CONFIG;

  // 2026-os D1 (személyautó) e-matrica árak, Ft — forrás: vintrica.com (NÚSZ árak alapján)
  // Ha változnak, itt kell átírni.
  const VIGNETTE = {
    day: 5550, week: 6900, month: 11170, year: 61760,
    county: 7190, countyBAZ: 2500, m1region: 15000,
  };
  const M1_REGION = ["Pest", "Fejér", "Komárom-Esztergom", "Győr-Moson-Sopron"];
  const COUNTIES = ["Bács-Kiskun", "Baranya", "Békés", "Borsod-Abaúj-Zemplén", "Csongrád-Csanád", "Fejér", "Győr-Moson-Sopron",
    "Hajdú-Bihar", "Heves", "Jász-Nagykun-Szolnok", "Komárom-Esztergom", "Nógrád", "Pest", "Somogy", "Szabolcs-Szatmár-Bereg",
    "Tolna", "Vas", "Veszprém", "Zala"];
  // átlagárak 2026. október eleje (holtankoljak.hu szerint); a Beállításokban átírható
  const FUEL = { "95": { label: "95 benzin", price: 636 }, diesel: { label: "Dízel", price: 709 }, lpg: { label: "LPG", price: 330 } };

  const fmtFt = n => `${Math.round(n).toLocaleString("hu-HU")} Ft`;

  function fuelCost(distanceM, car) {
    const f = FUEL[car.fuel] ? car.fuel : "95";
    const price = +car.price || FUEL[f].price;
    const cons = +car.consumption || 6.5;
    return { ft: distanceM / 1000 / 100 * cons * price, price, cons, fuel: f };
  }

  // ---------- polyline6 kódolás (a Valhalla trace_attributes-hez) ----------
  function encode6(pts) {
    let out = "", pl = 0, pg = 0;
    const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
    for (const [la, lo] of pts) { const a = Math.round(la * 1e6), b = Math.round(lo * 1e6); out += enc(a - pl) + enc(b - pg); pl = a; pg = b; }
    return out;
  }

  // ---------- vármegye egy pontra (Nominatim, gyorsítótárral, 1 kérés/mp) ----------
  const countyCache = new Map(Object.entries(Store.ls.get("uthirnok.countyCache", {})));
  let lastReq = 0;
  async function countyOf(p) {
    const key = `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    if (countyCache.has(key)) return countyCache.get(key);
    const wait = Math.max(0, lastReq + 1100 - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastReq = Date.now();
    const res = await fetch(`${C.NOMINATIM_URL}/reverse?format=jsonv2&zoom=8&accept-language=hu&lat=${p[0]}&lon=${p[1]}`);
    if (!res.ok) throw new Error("Nominatim " + res.status);
    const a = (await res.json()).address || {};
    const ISO = { BK: "Bács-Kiskun", BA: "Baranya", BE: "Békés", BZ: "Borsod-Abaúj-Zemplén", CS: "Csongrád-Csanád", FE: "Fejér",
      GS: "Győr-Moson-Sopron", HB: "Hajdú-Bihar", HE: "Heves", JN: "Jász-Nagykun-Szolnok", KE: "Komárom-Esztergom", NO: "Nógrád",
      PE: "Pest", BU: "Pest", SO: "Somogy", SZ: "Szabolcs-Szatmár-Bereg", TO: "Tolna", VA: "Vas", VE: "Veszprém", ZA: "Zala" };
    let c = ISO[(a["ISO3166-2-lvl6"] || "").replace("HU-", "")] ||
      (a.county || a.state_district || "").replace(/\s+(vármegye|megye)$/i, "").trim();
    if (c === "Budapest" || (!c && /Budapest/i.test(a.city || a.state || ""))) c = "Pest";   // a budapesti M0-ra a Pest vármegyei matrica jó
    if (a.country_code && a.country_code !== "hu") c = "külföld";
    c = COUNTIES.find(x => x.toLowerCase() === c.toLowerCase()) || c || "?";
    countyCache.set(key, c);
    Store.ls.set("uthirnok.countyCache", Object.fromEntries([...countyCache].slice(-400)));
    return c;
  }

  function pointAt(rt, d) {
    let i = rt.cum.findIndex(c => c >= d);
    if (i <= 0) return rt.line[Math.max(0, i)];
    const t = (d - rt.cum[i - 1]) / ((rt.cum[i] - rt.cum[i - 1]) || 1);
    return [rt.line[i - 1][0] + (rt.line[i][0] - rt.line[i - 1][0]) * t, rt.line[i - 1][1] + (rt.line[i][1] - rt.line[i - 1][1]) * t];
  }

  // ---------- fizetős szakaszok + vármegyék egy útvonalra ----------
  async function tollInfo(rt, onPartial) {
    if (rt.toll) return rt.toll;
    const VH = (C.VALHALLA_URL || "https://valhalla1.openstreetmap.de").replace(/\/$/, "");
    // ritkítjuk a pontokat (hosszú útnál ritkábban), és 150 km-es darabokban kérdezzük
    const total = rt.cum[rt.cum.length - 1];
    const step = Math.max(30, total / 3000);
    const idx = [];
    let last = -1e9;
    rt.line.forEach((p, i) => { if (rt.cum[i] - last >= step || i === rt.line.length - 1) { idx.push(i); last = rt.cum[i]; } });
    const chunks = [];
    let cur = [];
    for (const i of idx) { cur.push(i); if (rt.cum[i] - rt.cum[cur[0]] > 150000) { chunks.push(cur); cur = [i]; } }
    if (cur.length > 1) chunks.push(cur);
    const flags = new Map();   // line index -> {toll, names}
    for (const ch of chunks) {
      const res = await fetch(`${VH}/trace_attributes`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shape: ch.map(i => ({ lat: +rt.line[i][0].toFixed(6), lon: +rt.line[i][1].toFixed(6) })), shape_match: "map_snap", costing: "auto",
          filters: { attributes: ["edge.toll", "edge.names", "matched.edge_index"], action: "include" } }) });
      const data = await res.json();
      if (!data.edges || !data.matched_points) throw new Error("A fizetős szakaszokat most nem tudom ellenőrizni.");
      data.matched_points.forEach((m, k) => { const e = m.edge_index != null ? data.edges[m.edge_index] : null; flags.set(ch[k], { toll: !!e?.toll, names: e?.names || [] }); });
    }
    // összefüggő fizetős szakaszok
    const sections = [];
    for (const i of idx) {
      const f = flags.get(i); if (!f?.toll) continue;
      const d = rt.cum[i], prev = sections[sections.length - 1];
      if (prev && d - prev.b < 400) { prev.b = d; f.names.forEach(n => prev.names.add(n)); }
      else sections.push({ a: d, b: d, names: new Set(f.names) });
    }
    const real = sections.filter(s => s.b - s.a > 150);
    onPartial?.({ km: real.reduce((x, s) => x + (s.b - s.a), 0) / 1000, names: [...new Set(real.flatMap(s => [...s.names]))].filter(n => /^M\d|^\d+$/.test(n)).slice(0, 3) });
    // vármegyék: minden szakasz eleje, vége és 20 km-enként egy pont
    const counties = new Set();
    for (const s of real) {
      const samples = [s.a + 80];
      for (let d = s.a + 20000; d < s.b - 4000; d += 20000) samples.push(d);
      samples.push(Math.max(s.a + 80, s.b - 80));
      s.counties = new Set();
      for (const d of samples) { try { const c = await countyOf(pointAt(rt, d)); if (c !== "külföld") { counties.add(c); s.counties.add(c); } } catch { s.unknown = true; } }
    }
    rt.toll = { sections: real.map(s => ({ a: s.a, b: s.b, names: [...s.names].filter(n => /^M\d|^\d+$/.test(n)).slice(0, 2), counties: [...s.counties] })),
      km: real.reduce((x, s) => x + (s.b - s.a), 0) / 1000, counties: [...counties].filter(c => c !== "?") };
    return rt.toll;
  }

  // ---------- érvényes-e a matricám, és ha nem, mi a legolcsóbb ----------
  function myCoverage(v, counties) {
    if (!v || v.type === "none") return false;
    const valid = !v.until || new Date(v.until + "T23:59:59") >= new Date();
    if (!valid) return false;
    if (["year", "month", "week", "day"].includes(v.type)) return true;
    if (v.type === "m1region") return counties.every(c => M1_REGION.includes(c) || (v.counties || []).includes(c));
    if (v.type === "county") return counties.every(c => (v.counties || []).includes(c));
    return false;
  }
  function options(counties, v) {
    const missing = counties.filter(c => !((v?.type === "county" || v?.type === "m1region") && (v.counties || []).includes(c)));
    const countyPrice = missing.reduce((s, c) => s + (c === "Borsod-Abaúj-Zemplén" ? VIGNETTE.countyBAZ : VIGNETTE.county), 0);
    const opts = [
      { label: "Napi (országos)", price: VIGNETTE.day },
      { label: "10 napos (országos)", price: VIGNETTE.week },
      { label: "Havi (országos)", price: VIGNETTE.month },
    ];
    if (missing.length && missing.length <= 4) opts.push({ label: `${missing.length} vármegyei éves (${missing.join(", ")})`, price: countyPrice, yearly: true });
    if (counties.length && counties.every(c => M1_REGION.includes(c))) opts.push({ label: "M1 regionális éves", price: VIGNETTE.m1region, yearly: true });
    opts.push({ label: "Országos éves", price: VIGNETTE.year, yearly: true });
    opts.sort((a, b) => a.price - b.price);
    return { missing, opts };
  }

  return { VIGNETTE, COUNTIES, FUEL, M1_REGION, fmtFt, fuelCost, tollInfo, myCoverage, options, encode6, countyOf };
})();
