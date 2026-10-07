// Jelzéstípusok: ikon, szín, élettartam (perc), útvonal-büntetés (mp), figyelmeztetési távolság (m)
const Reports = (() => {
  const TYPES = {
    police:  { label: "Rendőr", ico: "👮", color: "#2f6fed", ttl: 60, penalty: 0, warn: 800,
      subs: [["visible", "Látható ellenőrzés"], ["hidden", "Rejtett"], ["other_side", "Másik oldalon"]] },
    camera:  { label: "Traffi", ico: "📸", color: "#7c3aed", ttl: 120, penalty: 0, warn: 900,
      subs: [["mobile", "Mobil traffipax"], ["fixed", "Fix traffipax"], ["section", "Szakaszmérés"], ["redlight", "Piros lámpás kamera"]] },
    accident:{ label: "Baleset", ico: "💥", color: "#e11d48", ttl: 90, penalty: 600, warn: 1200,
      subs: [["minor", "Kisebb"], ["major", "Súlyos"], ["other_side", "Másik oldalon"]] },
    jam:     { label: "Dugó", ico: "🚗", color: "#ea580c", ttl: 30, penalty: 420, warn: 1500,
      subs: [["moderate", "Lassú forgalom"], ["heavy", "Erős dugó"], ["standstill", "Áll a sor"]] },
    closure: { label: "Útépítés, lezárás", ico: "🚧", color: "#b91c1c", ttl: 24 * 60, penalty: 7200, warn: 2000,
      subs: [["roadwork", "Útépítés"], ["lane", "Sávlezárás"], ["full", "Teljes lezárás"]] },
    hazard:  { label: "Veszély", ico: "⚠️", color: "#d97706", ttl: 120, penalty: 60, warn: 700,
      subs: [["pothole", "Kátyú"], ["object", "Tárgy az úton"], ["stopped", "Álló jármű"], ["animal", "Állat az úton"],
             ["ice", "Jeges út"], ["fog", "Köd"], ["flood", "Víz az úton"], ["snow", "Hó"]] },
    parking: { label: "Szabad parkoló", ico: "🅿️", color: "#0891b2", ttl: 20, penalty: 0, warn: 0,
      subs: [["free", "Szabad hely"], ["free_paid", "Szabad (fizetős)"], ["full", "Tele van"]] },
  };
  // altípusonként eltérő élettartam
  const SUB_TTL = { "hazard:pothole": 7 * 24 * 60, "camera:fixed": 30 * 24 * 60, "camera:section": 30 * 24 * 60,
                    "camera:redlight": 30 * 24 * 60, "hazard:ice": 240, "hazard:fog": 180, "hazard:snow": 360 };

  const ttlOf = (type, sub) => SUB_TTL[`${type}:${sub}`] || TYPES[type]?.ttl || 60;
  const subLabel = r => (TYPES[r.type]?.subs.find(s => s[0] === r.sub) || [, ""])[1];
  const isHidden = r => r.down >= r.up + 2;

  function iconEl(r) {
    const t = TYPES[r.type] || TYPES.hazard;
    const el = document.createElement("div");
    el.className = "rep-pin";
    el.style.setProperty("--c", t.color);
    el.innerHTML = `<span>${t.ico}</span>`;
    return el;
  }

  function popupHtml(r) {
    const t = TYPES[r.type] || TYPES.hazard;
    const mv = Store.myVote(r.id);
    return `
      <div class="pp-title">${t.ico} ${t.label}</div>
      <div class="pp-sub">${subLabel(r)}${r.note ? " · " + escapeHtml(r.note) : ""}<br>
        ${Geo.fmtAgo(r.created_at)}${r.nick ? " · " + escapeHtml(r.nick) : ""} · 👍 ${r.up} · 👎 ${r.down}</div>
      ${mv ? `<div class="hint">${mv > 0 ? "Megerősítetted." : "Jelezted, hogy már nincs ott."}</div>` : `
      <div class="pp-row">
        <button class="btn primary" data-vote="1" data-id="${r.id}">👍 Még ott van</button>
        <button class="btn" data-vote="-1" data-id="${r.id}">👎 Már nincs</button>
      </div>`}`;
  }

  // jelzések egy útvonal mentén (60 m-en belül) — mennyire "drága" az útvonal, és hol vannak rajta
  function onRoute(list, rt) {
    const hits = [];
    for (const r of list) {
      if (isHidden(r)) continue;
      const n = Geo.nearestOnLine([r.lat, r.lng], rt.line);
      if (n.d < 60) hits.push({ ...r, along: rt.cum[n.i] + ((rt.cum[n.i + 1] ?? rt.cum[n.i]) - rt.cum[n.i]) * n.t });
    }
    const mult = r => r.sub === "other_side" ? 0 : r.sub === "lane" ? 0.15 : r.sub === "roadwork" ? 0.08 : 1;
    const penalty = hits.reduce((s, r) => s + (TYPES[r.type]?.penalty || 0) * mult(r), 0);
    return { hits, penalty };
  }

    // útvonal színezése a jelzések alapján: dugó/baleset/lezárás előtt narancs/piros szakasz
  function trafficSegments(rt, hits, from = 0) {
    const total = rt.cum[rt.cum.length - 1];
    const marks = [];
    for (const h of hits) {
      if (h.sub === "other_side") continue;
      let len = 0, color = null;
      if (h.type === "jam") { len = h.sub === "standstill" ? 1500 : h.sub === "heavy" ? 1000 : 600; color = h.sub === "moderate" ? "#f59e0b" : "#ef4444"; }
      else if (h.type === "accident") { len = 700; color = "#ef4444"; }
      else if (h.type === "closure" && h.sub !== "full") { len = 400; color = "#f59e0b"; }
      else if (h.type === "closure") { len = 300; color = "#7f1d1d"; }
      if (color) marks.push({ a: Math.max(from, h.along - len), b: h.along + 60, color });
    }
    marks.sort((x, y) => x.a - y.a);
    const base = document.body.classList.contains("dark") ? "#3d95ff" : "#0a84ff";
    const segs = []; let cur = from;
    for (const m of marks) {
      if (m.b <= cur) continue;
      if (m.a > cur) segs.push({ a: cur, b: m.a, color: base });
      segs.push({ a: Math.max(cur, m.a), b: Math.min(total, m.b), color: m.color });
      cur = Math.min(total, m.b);
    }
    if (cur < total) segs.push({ a: cur, b: total, color: base });
    return segs.map(s => ({ ...s, coords: Routing.slice(rt, s.a, s.b) })).filter(s => s.coords.length > 1);
  }

  return { TYPES, ttlOf, subLabel, isHidden, iconEl, popupHtml, onRoute, trafficSegments };
})();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
