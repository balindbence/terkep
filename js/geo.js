// Földrajzi segédfüggvények + formázás
const Geo = (() => {
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;

  // távolság méterben; a, b = [lat, lng]
  function dist(a, b) {
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // irányszög a-ból b-be (0 = észak, fok)
  function bearing(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  // helyi síkvetület (kis távolságokra elég pontos)
  function project(p, ref) {
    return [rad(p[1] - ref[1]) * R * Math.cos(rad(ref[0])), rad(p[0] - ref[0]) * R];
  }

  // pont távolsága egy vonallánctól + legközelebbi szakasz indexe + vetületi arány
  function nearestOnLine(p, line, from = 0, to = line.length - 1) {
    let best = { d: Infinity, i: from, t: 0 };
    for (let i = Math.max(0, from); i < Math.min(to, line.length - 1); i++) {
      const a = project(line[i], p), b = project(line[i + 1], p);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy || 1e-9;
      let t = -(a[0] * dx + a[1] * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const x = a[0] + t * dx, y = a[1] + t * dy;
      const d = Math.hypot(x, y);
      if (d < best.d) best = { d, i, t };
    }
    return best;
  }

  // a vonallánc hossza egy adott ponttól (i, t) a végéig
  function remainingLength(line, i, t) {
    let sum = dist(line[i], line[i + 1] || line[i]) * (1 - t);
    for (let k = i + 1; k < line.length - 1; k++) sum += dist(line[k], line[k + 1]);
    return sum;
  }

  // kumulatív hosszak
  function cumulative(line) {
    const c = [0];
    for (let i = 1; i < line.length; i++) c.push(c[i - 1] + dist(line[i - 1], line[i]));
    return c;
  }

  function fmtDist(m) {
    if (m == null || isNaN(m)) return "–";
    if (m < 50) return "most";
    if (m < 1000) return `${Math.round(m / 10) * 10} m`;
    if (m < 10000) return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
    return `${Math.round(m / 1000)} km`;
  }
  function fmtDur(s) {
    const m = Math.round(s / 60);
    if (m < 60) return `${m} perc`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} ó ${r} p` : `${h} óra`;
  }
  function fmtClock(date) {
    return date.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
  }
  function fmtAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "épp most";
    if (s < 3600) return `${Math.round(s / 60)} perce`;
    if (s < 86400) return `${Math.round(s / 3600)} órája`;
    return `${Math.round(s / 86400)} napja`;
  }

  return { dist, bearing, angleDiff, nearestOnLine, remainingLength, cumulative, fmtDist, fmtDur, fmtClock, fmtAgo };
})();
