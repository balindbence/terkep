// Adattároló: Supabase (közösségi) vagy helyi (localStorage) mód
const Store = (() => {
  const C = window.UTHIRNOK_CONFIG;
  const live = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);

  const ls = {
    get(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // anonim felhasználói azonosító (nincs regisztráció)
  let userId = ls.get("uthirnok.uid", null);
  if (!userId) { userId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); ls.set("uthirnok.uid", userId); }

  // ---------- Supabase REST ----------
  const base = C.SUPABASE_URL.replace(/\/$/, "");
  const headers = () => ({
    apikey: C.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${C.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  });
  async function sb(path, opts = {}) {
    const res = await fetch(`${base}/rest/v1/${path}`, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  // ---------- helyi tároló ----------
  const localReports = () => ls.get("uthirnok.reports", []).filter(r => new Date(r.expires_at) > new Date());
  const saveLocalReports = arr => ls.set("uthirnok.reports", arr);

  async function listReports(b) {
    // b = {s, w, n, e}
    if (live) {
      const now = new Date().toISOString();
      const q = `reports?select=*&lat=gte.${b.s}&lat=lte.${b.n}&lng=gte.${b.w}&lng=lte.${b.e}&expires_at=gt.${now}&order=created_at.desc&limit=800`;
      return sb(q);
    }
    return localReports().filter(r => r.lat >= b.s && r.lat <= b.n && r.lng >= b.w && r.lng <= b.e);
  }

  async function addReport(r) {
    const row = { ...r, user_id: userId, up: 1, down: 0 };
    if (live) {
      const out = await sb("reports", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
      return out[0];
    }
    row.id = "L" + Date.now() + Math.random().toString(16).slice(2, 6);
    row.created_at = new Date().toISOString();
    const all = localReports(); all.push(row); saveLocalReports(all);
    return row;
  }

  async function vote(id, val, ttlMin) {
    const voted = ls.get("uthirnok.votes", {});
    if (voted[id]) return false;          // egy eszköz egyszer szavazhat
    voted[id] = val; ls.set("uthirnok.votes", voted);
    if (live) { await sb("rpc/vote_report", { method: "POST", body: JSON.stringify({ rid: id, val }) }); return true; }
    const all = localReports();
    const r = all.find(x => x.id === id);
    if (r) {
      if (val > 0) { r.up++; r.expires_at = new Date(Math.max(new Date(r.expires_at), Date.now() + ttlMin * 30000)).toISOString(); }
      else r.down++;
      saveLocalReports(all);
    }
    return true;
  }
  const myVote = id => ls.get("uthirnok.votes", {})[id] || 0;

  // ---------- benzinárak ----------
  async function listFuel(stationIds) {
    if (!stationIds.length) return [];
    if (live) {
      const ids = stationIds.map(s => `"${s}"`).join(",");
      return sb(`fuel_prices?select=*&station_id=in.(${ids})&order=created_at.desc&limit=2000`);
    }
    const set = new Set(stationIds);
    return ls.get("uthirnok.fuel", []).filter(f => set.has(f.station_id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async function addFuel(rows) {
    rows = rows.map(r => ({ ...r, user_id: userId }));
    if (live) return sb("fuel_prices", { method: "POST", body: JSON.stringify(rows) });
    const all = ls.get("uthirnok.fuel", []);
    rows.forEach(r => all.push({ ...r, created_at: new Date().toISOString() }));
    ls.set("uthirnok.fuel", all.slice(-3000));
  }

  return { live, userId, ls, listReports, addReport, vote, myVote, listFuel, addFuel };
})();
