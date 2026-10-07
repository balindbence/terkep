// Jelzéstípusok: ikon, szín, élettartam (perc), útvonal-büntetés (mp), figyelmeztetési távolság (m)
const Reports = (() => {
  const TYPES = {
    police:  { label: "Rendőr", ico: "👮", color: "#2f6fed", ttl: 60, penalty: 0, warn: 800,
      subs: [["visible", "Látható ellenőrzés"], ["hidden", "Rejtett"], ["other_side", "Másik oldalon"]] },
    camera:  { label: "Traffipax", ico: "📸", color: "#7c3aed", ttl: 120, penalty: 0, warn: 900,
      subs: [["mobile", "Mobil traffipax"], ["fixed", "Fix traffipax"], ["section", "Szakaszmérés"], ["redlight", "Piros lámpás kamera"]] },
    accident:{ label: "Baleset", ico: "💥", color: "#e11d48", ttl: 90, penalty: 600, warn: 1200,
      subs: [["minor", "Kisebb"], ["major", "Súlyos"], ["other_side", "Másik oldalon"]] },
    jam:     { label: "Dugó", ico: "🚗", color: "#ea580c", ttl: 30, penalty: 420, warn: 1500,
      subs: [["moderate", "Lassú forgalom"], ["heavy", "Erős dugó"], ["standstill", "Áll a sor"]] },
    closure: { label: "Útlezárás", ico: "⛔", color: "#b91c1c", ttl: 24 * 60, penalty: 7200, warn: 2000,
      subs: [["full", "Teljes lezárás"], ["lane", "Sávlezárás"], ["roadwork", "Útépítés"]] },
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

  function icon(r, size = 38) {
    const t = TYPES[r.type] || TYPES.hazard;
    return L.divIcon({
      className: "",
      html: `<div class="rep-pin" style="background:${t.color};width:${size}px;height:${size}px"><span>${t.ico}</span></div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size + 4], popupAnchor: [0, -size],
    });
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
        <button class="pill ok" data-vote="1" data-id="${r.id}">Még ott van</button>
        <button class="pill no" data-vote="-1" data-id="${r.id}">Már nincs</button>
      </div>`}`;
  }

  // jelzések egy útvonal mentén (60 m-en belül) — mennyire "drága" az útvonal
  function onRoute(list, line) {
    const hits = [];
    for (const r of list) {
      if (isHidden(r)) continue;
      const n = Geo.nearestOnLine([r.lat, r.lng], line);
      if (n.d < 60) hits.push(r);
    }
    const penalty = hits.reduce((s, r) => s + (TYPES[r.type]?.penalty || 0) * (r.sub === "lane" ? 0.15 : r.sub === "other_side" ? 0 : 1), 0);
    return { hits, penalty };
  }

  return { TYPES, ttlOf, subLabel, isHidden, icon, popupHtml, onRoute };
})();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
