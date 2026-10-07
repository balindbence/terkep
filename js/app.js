// Úthírnök — fő alkalmazás
(() => {
  const C = window.UTHIRNOK_CONFIG;
  const $ = s => document.querySelector(s);
  const T = Reports.TYPES;

  // ================= állapot =================
  const saved = Store.ls.get("uthirnok.settings", {});
  const S = {
    me: null, heading: null, speed: 0, follow: true, lastFix: null,
    settings: Object.assign({ voice: true, nick: "", avoidTolls: false, avoidMotorways: false, theme: "auto",
      layers: { reports: true, camera: true, fuel: true, parking: false } }, saved),
    dest: null, routes: [], sel: 0,
    nav: null,             // { rt, idx, offCount, spoken:Set, lastReroute }
    reports: new Map(), markers: new Map(),
    alerted: new Map(),    // id -> 'warned' | 'passed'
    activeAlert: null, pickPoint: null, sim: null,
  };
  const saveSettings = () => Store.ls.set("uthirnok.settings", S.settings);

  // ================= térkép =================
  const map = L.map("map", { zoomControl: false, attributionControl: true, tap: true })
    .setView(C.DEFAULT_CENTER, C.DEFAULT_ZOOM);
  const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';
  const tiles = {
    light: L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: ATTR, maxZoom: 20, subdomains: "abcd" }),
    dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: ATTR, maxZoom: 20, subdomains: "abcd" }),
  };
  let currentTiles = null;
  function applyTheme() {
    let t = S.settings.theme;
    if (t === "auto") { const h = new Date().getHours(); t = h >= 19 || h < 7 ? "dark" : "light"; }
    document.body.classList.toggle("light", t === "light");
    document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#f4f6fa" : "#0f1724";
    if (currentTiles !== tiles[t]) { if (currentTiles) map.removeLayer(currentTiles); currentTiles = tiles[t].addTo(map); }
  }
  applyTheme();
  setInterval(applyTheme, 5 * 60000);

  const routeLayer = L.layerGroup().addTo(map);
  const reportLayer = L.layerGroup().addTo(map);
  const poiLayers = { camera: L.layerGroup().addTo(map), fuel: L.layerGroup().addTo(map), parking: L.layerGroup().addTo(map) };
  let meMarker = null, destMarker = null;

  const bounds = (pad = 0) => {
    const b = map.getBounds().pad(pad);
    return { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
  };

  // ================= segédek =================
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  }
  let huVoice = null;
  function pickVoice() { huVoice = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith("hu")) || null; }
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!S.settings.voice || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "hu-HU"; if (huVoice) u.voice = huVoice; u.rate = 1.02;
    try { speechSynthesis.speak(u); } catch {}
  }
  const spokenDist = m => m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",").replace(",0", "")} kilométer` : `${Math.round(m / 50) * 50 || 50} méter`;

  function openSheet(html) { $("#sheetBody").innerHTML = html; $("#sheet").classList.remove("hidden"); document.body.classList.add("sheet-open"); }
  function closeSheet() { $("#sheet").classList.add("hidden"); document.body.classList.remove("sheet-open"); }
  function openModal(title, html) { $("#modalTitle").textContent = title; $("#modalBody").innerHTML = html; $("#modal").classList.remove("hidden"); }
  function closeModal() { $("#modal").classList.add("hidden"); }
  $("#modalClose").onclick = closeModal;
  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });

  const badge = $("#mode-badge");
  badge.textContent = Store.live ? "● Közösségi mód" : "○ Helyi mód";
  badge.classList.toggle("live", Store.live);
  badge.onclick = () => openSettings();

  // ================= helymeghatározás =================
  function meIcon() {
    return L.divIcon({ className: "", iconSize: [44, 44], iconAnchor: [22, 22],
      html: `<div class="me-wrap"><div class="me-dot">${S.heading != null ? `<div class="me-arrow" style="transform:rotate(${S.heading}deg)"></div>` : ""}</div></div>` });
  }

  function onPosition(lat, lng, speedMs, headingDeg, acc) {
    const pos = [lat, lng];
    if (S.me && Geo.dist(S.me, pos) > 4) {
      if (headingDeg == null || isNaN(headingDeg) || (speedMs ?? 0) < 1) headingDeg = Geo.bearing(S.me, pos);
    }
    if (headingDeg != null && !isNaN(headingDeg)) S.heading = headingDeg;
    S.me = pos; S.speed = Math.max(0, (speedMs ?? 0) * 3.6); S.lastFix = Date.now();

    if (!meMarker) meMarker = L.marker(pos, { icon: meIcon(), zIndexOffset: 1000, interactive: false }).addTo(map);
    else { meMarker.setLatLng(pos); meMarker.setIcon(meIcon()); }

    if (S.follow) {
      const z = S.nav ? (S.speed > 90 ? 15 : 17) : Math.max(map.getZoom(), 15);
      map.setView(pos, z, { animate: true });
    }
    $("#spdVal").textContent = Math.round(S.speed);
    updateLimit();
    if (S.nav) navTick();
    checkAlerts();
  }

  let watchId = null;
  function startGps() {
    if (!("geolocation" in navigator)) { toast("Ez az eszköz nem ad helyadatot."); return; }
    watchId = navigator.geolocation.watchPosition(
      p => { if (!S.sim) onPosition(p.coords.latitude, p.coords.longitude, p.coords.speed, p.coords.heading, p.coords.accuracy); },
      err => {
        if (err.code === 1) toast("A helyhozzáférés le van tiltva — engedélyezd a beállításokban.");
        else ipFallback();
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  startGps();
  // ha nincs GPS (pl. asztali gépen), legalább a város környékére álljon a térkép
  let ipTried = false;
  async function ipFallback() {
    if (ipTried || S.me) return; ipTried = true;
    try {
      const j = await (await fetch("https://ipapi.co/json/")).json();
      if (!S.me && j.latitude) map.setView([j.latitude, j.longitude], 13);
    } catch {}
  }
  setTimeout(() => { if (!S.me) ipFallback(); }, 9000);

  map.on("dragstart", () => { S.follow = false; $("#btnLocate").classList.remove("on"); });
  $("#btnLocate").onclick = () => {
    S.follow = true; $("#btnLocate").classList.add("on");
    if (S.me) map.setView(S.me, Math.max(map.getZoom(), 16)); else toast("Még keresem a helyzeted…");
  };
  $("#btnLocate").classList.add("on");

  // ================= sebességkorlát =================
  let limitBusy = false;
  async function updateLimit() {
    if (limitBusy || !S.me || (S.speed < 8 && !S.nav)) return;
    limitBusy = true;
    const lim = await Pois.speedLimit(S.me, S.heading);
    limitBusy = false;
    $("#limit").classList.toggle("hidden", !lim);
    if (lim) $("#limitVal").textContent = lim;
    const over = lim && S.speed > lim + 5;
    $("#spd").classList.toggle("over", !!over);
  }

  // ================= keresés =================
  const q = $("#q"), results = $("#results");
  let searchTimer, searchCtl, lastResults = [];
  q.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const v = q.value.trim();
    if (v.length < 3) { results.classList.add("hidden"); return; }
    searchTimer = setTimeout(() => search(v), 450);
  });
  q.addEventListener("keydown", e => {
    if (e.key === "Enter") { clearTimeout(searchTimer); if (lastResults[0]) choose(lastResults[0]); else search(q.value.trim(), true); }
    if (e.key === "Escape") results.classList.add("hidden");
  });
  async function search(v, pickFirst = false) {
    const coord = v.match(/^\s*(-?\d+[.,]\d+)[\s,;]+(-?\d+[.,]\d+)\s*$/);
    if (coord) return choose({ lat: +coord[1].replace(",", "."), lon: +coord[2].replace(",", "."), display_name: "Koordináta" });
    searchCtl?.abort(); searchCtl = new AbortController();
    const c = S.me || [map.getCenter().lat, map.getCenter().lng];
    const vb = `${c[1] - 1.5},${c[0] + 1},${c[1] + 1.5},${c[0] - 1}`;
    try {
      const url = `${C.NOMINATIM_URL}/search?format=jsonv2&addressdetails=1&limit=7&accept-language=hu&viewbox=${vb}&q=${encodeURIComponent(v)}`;
      const data = await (await fetch(url, { signal: searchCtl.signal })).json();
      lastResults = data;
      if (pickFirst && data[0]) return choose(data[0]);
      results.innerHTML = data.length ? data.map((r, i) => {
        const [first, ...rest] = r.display_name.split(", ");
        const d = S.me ? " · " + Geo.fmtDist(Geo.dist(S.me, [+r.lat, +r.lon])) : "";
        return `<li data-i="${i}"><b>${escapeHtml(r.name || first)}</b><small>${escapeHtml(rest.slice(0, 3).join(", "))}${d}</small></li>`;
      }).join("") : `<li><small>Nincs találat.</small></li>`;
      results.classList.remove("hidden");
    } catch (e) { if (e.name !== "AbortError") toast("A keresés most nem elérhető."); }
  }
  results.addEventListener("click", e => { const li = e.target.closest("li[data-i]"); if (li) choose(lastResults[+li.dataset.i]); });
  function choose(r) {
    results.classList.add("hidden"); q.blur();
    const name = r.name || r.display_name.split(", ")[0];
    showPlace([+r.lat, +r.lon], name, r.display_name.split(", ").slice(1, 4).join(", "));
  }

  function setDest(pos) {
    S.dest = pos;
    const ic = L.divIcon({ className: "", html: '<div class="dest-pin">📍</div>', iconSize: [34, 34], iconAnchor: [17, 32] });
    if (destMarker) destMarker.setLatLng(pos); else destMarker = L.marker(pos, { icon: ic, zIndexOffset: 900 }).addTo(map);
  }

  function showPlace(pos, name, sub = "") {
    setDest(pos); S.destName = name;
    S.follow = false; map.setView(pos, 16);
    const d = S.me ? Geo.fmtDist(Geo.dist(S.me, pos)) + " légvonalban" : "";
    openSheet(`
      <div class="sheet-title">${escapeHtml(name)}</div>
      <div class="sheet-sub">${escapeHtml(sub)}${sub && d ? " · " : ""}${d}</div>
      <div class="row">
        <button class="pill primary" id="goRoute">Útvonal ide</button>
        <button class="pill" id="goCancel">Bezár</button>
      </div>`);
    $("#goRoute").onclick = () => planRoute();
    $("#goCancel").onclick = clearAll;
  }

  // hosszú nyomás / jobb klikk a térképen
  map.on("contextmenu", e => {
    const p = [e.latlng.lat, e.latlng.lng];
    S.pickPoint = p;
    L.popup({ closeButton: false }).setLatLng(e.latlng).setContent(`
      <div class="ctx">
        <button class="pill primary" id="ctxGo">🧭 Navigálj ide</button>
        <button class="pill accent" id="ctxRep">＋ Jelzés ide</button>
      </div>`).openOn(map);
    setTimeout(() => {
      $("#ctxGo").onclick = () => { map.closePopup(); showPlace(p, "Kijelölt pont", `${p[0].toFixed(5)}, ${p[1].toFixed(5)}`); };
      $("#ctxRep").onclick = () => { map.closePopup(); openReport(p); };
    });
  });

  function clearAll() {
    stopNav(false); stopSim();
    routeLayer.clearLayers(); S.routes = [];
    if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
    S.dest = null; closeSheet(); q.value = "";
  }

  // ================= útvonaltervezés =================
  async function ensureReportsAround(line) {
    let s = 90, w = 180, n = -90, e = -180;
    for (const [la, lo] of line) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
    try { (await Store.listReports({ s: s - .01, w: w - .01, n: n + .01, e: e + .01 })).forEach(r => S.reports.set(r.id, r)); } catch {}
  }

  async function planRoute() {
    if (!S.dest) return;
    let from = S.me;
    if (!from) { const c = map.getCenter(); from = [c.lat, c.lng]; toast("Nincs GPS — a térkép közepéről tervezek."); }
    openSheet(`<div class="sheet-title">Útvonalak keresése…</div><div class="sheet-sub">Közösségi jelzéseket is figyelembe veszem.</div>`);
    try {
      const routes = await Routing.route(from, S.dest, { avoidTolls: S.settings.avoidTolls, avoidMotorways: S.settings.avoidMotorways });
      await ensureReportsAround(routes[0].line);
      const active = [...S.reports.values()];
      routes.forEach(rt => { const x = Reports.onRoute(active, rt.line); rt.hits = x.hits; rt.penalty = x.penalty; rt.score = rt.duration + x.penalty; });
      routes.sort((a, b) => a.score - b.score);
      S.routes = routes; S.sel = 0;
      drawRoutes(true); showRouteSheet();
    } catch (e) {
      openSheet(`<div class="sheet-title">Hiba</div><div class="sheet-sub">${escapeHtml(e.message)}</div>
        <div class="row"><button class="pill primary" id="retry">Újra</button><button class="pill" id="goCancel">Bezár</button></div>`);
      $("#retry").onclick = planRoute; $("#goCancel").onclick = clearAll;
    }
  }

  function drawRoutes(fit) {
    routeLayer.clearLayers();
    S.routes.forEach((rt, i) => {
      if (i === S.sel) return;
      L.polyline(rt.line, { color: "#8a97ab", weight: 7, opacity: .7 }).on("click", () => { S.sel = i; drawRoutes(); showRouteSheet(); }).addTo(routeLayer);
    });
    const rt = S.routes[S.sel];
    if (!rt) return;
    L.polyline(rt.line, { color: "#0b3d91", weight: 11, opacity: .9 }).addTo(routeLayer);
    L.polyline(rt.line, { color: "#3b8bff", weight: 7 }).addTo(routeLayer);
    if (fit) { S.follow = false; map.fitBounds(L.latLngBounds(rt.line), { paddingTopLeft: [30, 90], paddingBottomRight: [30, window.innerWidth >= 900 ? 30 : 320] }); }
  }

  function hitTags(hits) {
    const by = {};
    hits.forEach(r => { by[r.type] = (by[r.type] || 0) + 1; });
    return Object.entries(by).map(([t, n]) => `<span class="tag warn">${T[t].ico} ${n} ${T[t].label.toLowerCase()}</span>`).join("");
  }

  function showRouteSheet() {
    const cards = S.routes.map((rt, i) => {
      const arrive = Geo.fmtClock(new Date(Date.now() + rt.score * 1000));
      return `<button class="route-card ${i === S.sel ? "sel" : ""}" data-r="${i}">
        <div class="rt-time">${Geo.fmtDur(rt.score)}</div>
        <div class="rt-meta"><b>${Geo.fmtDist(rt.distance)}</b> · érkezés ${arrive}<br>
          ${rt.roads.length ? "via " + escapeHtml(rt.roads.join(", ")) : ""}<br>
          ${i === 0 ? '<span class="tag best">Leggyorsabb most</span>' : ""}
          ${rt.penalty > 0 ? `<span class="tag warn">+${Math.round(rt.penalty / 60)} perc a jelzések miatt</span>` : ""}
          ${hitTags(rt.hits)}</div>
      </button>`;
    }).join("");
    openSheet(`
      <div class="sheet-title">${escapeHtml(S.destName || "Úti cél")}</div>
      <div class="routes">${cards}</div>
      <div class="opts">
        <label><input type="checkbox" id="optToll" ${S.settings.avoidTolls ? "checked" : ""}> Fizetős utak nélkül</label>
        <label><input type="checkbox" id="optMw" ${S.settings.avoidMotorways ? "checked" : ""}> Autópálya nélkül</label>
      </div>
      <div class="row">
        <button class="pill primary" id="goNav">▶ Indulás</button>
        <button class="pill" id="goSim" title="Kipróbálás GPS nélkül">Szimuláció</button>
        <button class="pill" id="goCancel">Mégse</button>
      </div>`);
    document.querySelectorAll(".route-card").forEach(b => b.onclick = () => { S.sel = +b.dataset.r; drawRoutes(); showRouteSheet(); });
    $("#optToll").onchange = e => { S.settings.avoidTolls = e.target.checked; saveSettings(); planRoute(); };
    $("#optMw").onchange = e => { S.settings.avoidMotorways = e.target.checked; saveSettings(); planRoute(); };
    $("#goNav").onclick = () => startNav();
    $("#goSim").onclick = () => startSim();
    $("#goCancel").onclick = clearAll;
  }

  // ================= navigáció =================
  let wakeLock = null;
  async function startNav() {
    const rt = S.routes[S.sel];
    if (!rt) return;
    S.routes = [rt]; S.sel = 0; drawRoutes();
    S.nav = { rt, idx: 0, offCount: 0, spoken: new Set(), lastReroute: 0, routeAlong: new Map() };
    S.alerted.clear();
    S.follow = true; $("#btnLocate").classList.add("on");
    document.body.classList.add("navigating");
    $("#maneuver").classList.remove("hidden");
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
    speak(`Indulás. ${Geo.fmtDur(rt.duration)} az út.`);
    if (S.me) navTick(); else renderNavSheet(0, rt.distance);
  }

  function stopNav(msg = true) {
    if (!S.nav) return;
    S.nav = null;
    document.body.classList.remove("navigating");
    $("#maneuver").classList.add("hidden");
    hideAlert();
    try { wakeLock?.release(); } catch {} wakeLock = null;
    if (msg) { stopSim(); routeLayer.clearLayers(); closeSheet(); if (destMarker) { map.removeLayer(destMarker); destMarker = null; } }
  }

  function renderNavSheet(along, remaining) {
    const rt = S.nav.rt;
    const remSec = rt.duration * (remaining / rt.distance);
    const html = `
      <div class="nav-stats">
        <div><div class="big">${Geo.fmtClock(new Date(Date.now() + remSec * 1000))}</div><div class="muted">érkezés</div></div>
        <div><div class="big">${Geo.fmtDur(remSec)}</div><div class="muted">${Geo.fmtDist(remaining)}</div></div>
        <button class="pill danger" id="navStop">Vége</button>
      </div>`;
    if ($("#navStop")) { $("#sheetBody").innerHTML = html; } else openSheet(html);
    $("#navStop").onclick = () => { stopNav(); speak("Navigáció vége."); };
  }

  function navTick() {
    const nav = S.nav; if (!nav || !S.me) return;
    const rt = nav.rt;
    const pr = Routing.progress(rt, S.me, nav.idx);
    nav.idx = pr.idx; nav.along = pr.along;

    // letértünk az útról → újratervezés
    if (pr.off > 50) {
      nav.offCount++;
      if (nav.offCount >= 3 && Date.now() - nav.lastReroute > 12000) { reroute(); return; }
    } else nav.offCount = 0;

    const total = rt.cum[rt.cum.length - 1];
    const remaining = Math.max(0, total - pr.along);
    if (remaining < 30) {
      speak("Megérkeztél az úti célhoz.");
      toast("🏁 Megérkeztél!", 4000);
      stopNav(); return;
    }

    const si = rt.steps.findIndex(s => s.along > pr.along + 8);
    const step = rt.steps[si] || rt.steps[rt.steps.length - 1];
    const dNext = Math.max(0, step.along - pr.along);
    $("#mvArrow").textContent = step.arrow;
    $("#mvDist").textContent = Geo.fmtDist(dNext);
    $("#mvInstr").textContent = step.text + (step.name && step.type !== "arrive" ? " · " + step.name : "");

    const ths = S.speed > 75 ? [1500, 500, 80] : [600, 200, 40];
    for (const th of ths) {
      const key = `${si}:${th}`;
      if (dNext <= th && !nav.spoken.has(key)) {
        ths.forEach(t => { if (t >= th) nav.spoken.add(`${si}:${t}`); });
        const pre = th === ths[2] ? "" : `${spokenDist(dNext)} múlva `;
        speak(step.say ? `${pre}${step.say}` : `${pre}${step.text.toLowerCase()}${step.name ? ", " + step.name : ""}`);
        break;
      }
    }
    renderNavSheet(pr.along, remaining);
  }

  async function reroute() {
    const nav = S.nav; nav.lastReroute = Date.now(); nav.offCount = 0;
    toast("Útvonal újratervezése…"); speak("Újratervezés.");
    try {
      const [rt] = await Routing.route(S.me, S.dest, { avoidTolls: S.settings.avoidTolls, avoidMotorways: S.settings.avoidMotorways });
      if (!S.nav) return;
      Object.assign(nav, { rt, idx: 0, spoken: new Set(), routeAlong: new Map() });
      S.routes = [rt]; S.sel = 0; drawRoutes();
      if (S.sim) S.sim.rt = rt, S.sim.d = 0;
    } catch { toast("Nem sikerült újratervezni."); }
  }

  // ================= szimuláció (gépen való kipróbáláshoz) =================
  function startSim() {
    const rt = S.routes[S.sel]; if (!rt) return;
    stopSim();
    const kmh = 70;
    S.sim = { rt, d: 0, timer: null };
    onPosition(rt.line[0][0], rt.line[0][1], 0, null, 5);
    startNav();
    S.sim.timer = setInterval(() => {
      const sim = S.sim; if (!sim) return;
      const r = sim.rt;
      sim.d += kmh / 3.6 * 1.5;    // 1,5× gyorsítás
      const total = r.cum[r.cum.length - 1];
      if (sim.d >= total) sim.d = total;
      let i = r.cum.findIndex(c => c > sim.d) - 1; if (i < 0) i = r.cum.length - 2;
      const t = (sim.d - r.cum[i]) / ((r.cum[i + 1] - r.cum[i]) || 1);
      const a = r.line[i], b = r.line[i + 1];
      onPosition(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, kmh / 3.6, Geo.bearing(a, b), 5);
      if (sim.d >= total) stopSim();
    }, 1000);
    toast("Szimuláció: 70 km/h-val végigmegy az útvonalon.");
  }
  function stopSim() { if (S.sim) { clearInterval(S.sim.timer); S.sim = null; } }

  // ================= közösségi jelzések =================
  function renderReports() {
    const show = S.settings.layers.reports;
    const keep = new Set();
    for (const r of S.reports.values()) {
      if (!show || Reports.isHidden(r) || new Date(r.expires_at) < new Date()) continue;
      keep.add(r.id);
      let m = S.markers.get(r.id);
      if (!m) {
        m = L.marker([r.lat, r.lng], { icon: Reports.icon(r), zIndexOffset: 500 }).bindPopup(() => Reports.popupHtml(S.reports.get(r.id) || r));
        m.addTo(reportLayer); S.markers.set(r.id, m);
      }
    }
    for (const [id, m] of S.markers) if (!keep.has(id)) { reportLayer.removeLayer(m); S.markers.delete(id); }
  }

  async function refreshReports() {
    try {
      const list = await Store.listReports(bounds(0.6));
      const now = new Date();
      for (const [id, r] of S.reports) if (new Date(r.expires_at) < now) S.reports.delete(id);
      list.forEach(r => S.reports.set(r.id, r));
      renderReports();
    } catch (e) { console.warn(e); }
  }
  setInterval(refreshReports, C.POLL_MS);

  // szavazás a felugró ablakból / figyelmeztetésből
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-vote]"); if (!b) return;
    await doVote(b.dataset.id, +b.dataset.vote);
    map.closePopup();
  });
  async function doVote(id, val) {
    const r = S.reports.get(id); if (!r) return;
    try {
      const ok = await Store.vote(id, val, Reports.ttlOf(r.type, r.sub));
      if (!ok) { toast("Erre már szavaztál."); return; }
      if (val > 0) r.up++; else r.down++;
      toast(val > 0 ? "Köszi, megerősítve! 👍" : "Köszi, jelezve hogy eltűnt.");
      renderReports(); refreshReports();
    } catch { toast("A szavazás nem sikerült."); }
  }

  // ----- jelzés beküldése -----
  $("#btnReport").onclick = () => openReport(null);

  function openReport(point) {
    const tiles = Object.entries(T).map(([k, t]) =>
      `<button class="tile" data-t="${k}"><div class="t-ico" style="background:${t.color}">${t.ico}</div><div class="t-lbl">${t.label}</div></button>`).join("");
    openModal("Mit jelzel?", `<div class="grid">${tiles}</div>
      <p class="hint">${point ? "A kijelölt pontra kerül." : S.me ? "A jelenlegi helyedre kerül." : "Nincs GPS — a térkép közepére kerül."}
      ${Store.live ? "" : "<br>Helyi mód: csak ezen az eszközön látszik (lásd Beállítások)."}</p>`);
    document.querySelectorAll(".tile[data-t]").forEach(b => b.onclick = () => openReportDetail(b.dataset.t, point));
  }

  function openReportDetail(type, point) {
    const t = T[type];
    const subs = t.subs.map(([k, l], i) => `<button class="tile" data-s="${k}" style="${i === 0 ? "border-color:var(--accent)" : ""}"><div class="t-lbl">${l}</div></button>`).join("");
    openModal(`${t.ico} ${t.label}`, `
      <div class="grid">${subs}</div>
      <div class="field"><label>Megjegyzés (nem kötelező)</label><input id="repNote" maxlength="120" placeholder="pl. a benzinkút után, jobb sávban"></div>
      <div class="row"><button class="pill accent" id="repSend">Jelzés küldése</button></div>`);
    let sub = t.subs[0][0];
    document.querySelectorAll(".tile[data-s]").forEach(b => b.onclick = () => {
      sub = b.dataset.s;
      document.querySelectorAll(".tile[data-s]").forEach(x => x.style.borderColor = x === b ? "var(--accent)" : "transparent");
    });
    $("#repSend").onclick = async () => {
      const pos = point || S.me || [map.getCenter().lat, map.getCenter().lng];
      const ttl = Reports.ttlOf(type, sub);
      const row = { type, sub, lat: pos[0], lng: pos[1], heading: S.heading == null ? null : Math.round(S.heading),
        note: $("#repNote").value.trim().slice(0, 120) || null, nick: S.settings.nick || null,
        expires_at: new Date(Date.now() + ttl * 60000).toISOString() };
      $("#repSend").disabled = true;
      try {
        const saved = await Store.addReport(row);
        S.reports.set(saved.id, saved); Store.ls.set("uthirnok.votes", { ...Store.ls.get("uthirnok.votes", {}), [saved.id]: 1 });
        S.alerted.set(saved.id, "passed");   // a saját jelzésünkre ne figyelmeztessen
        renderReports(); closeModal();
        toast(`${t.ico} Köszi! A jelzés ${ttl >= 1440 ? Math.round(ttl / 1440) + " napig" : ttl >= 60 ? Math.round(ttl / 60) + " óráig" : ttl + " percig"} látszik.`);
      } catch (e) { toast("Nem sikerült elküldeni: " + e.message); $("#repSend").disabled = false; }
    };
  }

  // ================= figyelmeztetések (Waze-szerű) =================
  function alertCandidates() {
    const out = [];
    for (const r of S.reports.values()) {
      if (Reports.isHidden(r) || !T[r.type]?.warn || r.sub === "other_side") continue;
      out.push({ id: r.id, lat: r.lat, lng: r.lng, type: r.type, sub: r.sub, user: true, warn: T[r.type].warn });
    }
    for (const c of Pois.cache.camera.values())
      out.push({ id: "osm-" + c.id, lat: c.lat, lng: c.lng, type: "camera", sub: "fixed", user: false, warn: 900, limit: c.tags.maxspeed });
    return out;
  }

  function checkAlerts() {
    if (!S.me) return;
    let best = null;
    for (const c of alertCandidates()) {
      const p = [c.lat, c.lng];
      const air = Geo.dist(S.me, p);
      if (air > 2500) continue;
      const state = S.alerted.get(c.id);
      let ahead = null;
      if (S.nav) {
        const rt = S.nav.rt;
        let al = S.nav.routeAlong.get(c.id);
        if (al === undefined) {
          const n = Geo.nearestOnLine(p, rt.line);
          al = n.d < 45 ? rt.cum[n.i] + ((rt.cum[n.i + 1] ?? rt.cum[n.i]) - rt.cum[n.i]) * n.t : null;
          S.nav.routeAlong.set(c.id, al);
        }
        if (al != null) ahead = al - (S.nav.along ?? 0);
      } else if (S.heading != null && S.speed > 10) {
        if (Geo.angleDiff(Geo.bearing(S.me, p), S.heading) < 30) ahead = air;
        else if (state === "warned" && air < 120) ahead = -air;  // elhaladtunk mellette
      }
      if (ahead == null) continue;

      if (!state && ahead > 0 && ahead < c.warn) {
        S.alerted.set(c.id, "warned");
        const t = T[c.type];
        const lbl = c.user ? Reports.subLabel(c) || t.label : `Fix traffipax${c.limit ? ` (${c.limit} km/h)` : ""}`;
        speak(`Figyelem! ${spokenDist(ahead)} múlva ${c.user ? t.label.toLowerCase() : "fix traffipax"}.`);
        best = { c, ahead, lbl };
      } else if (state === "warned" && ahead < -25) {
        S.alerted.set(c.id, "passed");
        if (c.user && Store.myVote(c.id) === 0) askStillThere(c);
        else if (S.activeAlert?.c.id === c.id) hideAlert();
      } else if (state === "warned" && S.activeAlert?.c.id === c.id && ahead > 0) {
        $("#alSub").textContent = `${Geo.fmtDist(ahead)} múlva`;
      }
    }
    if (best && (!S.activeAlert || best.ahead < S.activeAlert.ahead)) showAlert(best);
  }

  let alertTimer;
  function showAlert(a) {
    S.activeAlert = a;
    const t = T[a.c.type];
    $("#alIco").textContent = t.ico;
    $("#alTitle").textContent = a.lbl;
    $("#alSub").textContent = `${Geo.fmtDist(a.ahead)} múlva`;
    $("#alActions").classList.add("hidden");
    $("#alert").style.borderColor = t.color;
    $("#alert").classList.remove("hidden");
    clearTimeout(alertTimer); alertTimer = setTimeout(hideAlert, 60000);
  }
  function askStillThere(c) {
    const t = T[c.type];
    S.activeAlert = { c, ahead: 0 };
    $("#alIco").textContent = t.ico;
    $("#alTitle").textContent = `${t.label} — még ott van?`;
    $("#alSub").textContent = "Segíts a többieknek egy koppintással.";
    $("#alActions").classList.remove("hidden");
    $("#alert").classList.remove("hidden");
    $("#alYes").onclick = () => { doVote(c.id, 1); hideAlert(); };
    $("#alNo").onclick = () => { doVote(c.id, -1); hideAlert(); };
    clearTimeout(alertTimer); alertTimer = setTimeout(hideAlert, 12000);
  }
  function hideAlert() { $("#alert").classList.add("hidden"); S.activeAlert = null; }

  // ================= OSM rétegek: traffipax, benzinkút, parkoló =================
  async function refreshPois() {
    const z = map.getZoom(), b = bounds();
    const L_ = S.settings.layers;
    const kinds = [];
    if ((L_.camera || S.nav) && z >= 10) kinds.push("camera");
    if (L_.fuel && z >= 12) kinds.push("fuel");
    if (L_.parking && z >= 14) kinds.push("parking");
    try { await Pois.load(b, kinds); } catch (e) { console.warn(e); }
    await renderPois(b, z);
  }

  async function renderPois(b, z) {
    const L_ = S.settings.layers;
    Object.values(poiLayers).forEach(l => l.clearLayers());
    if (L_.camera && z >= 10) for (const c of Pois.inView(Pois.cache.camera, b).slice(0, 300)) {
      L.marker([c.lat, c.lng], { icon: L.divIcon({ className: "", html: `<div class="poi-pin" style="background:#7c3aed">📸${c.tags.maxspeed ? " " + escapeHtml(c.tags.maxspeed) : ""}</div>`, iconSize: null, iconAnchor: [14, 12] }) })
        .bindPopup(`<div class="pp-title">📸 Fix traffipax</div><div class="pp-sub">OpenStreetMap adat${c.tags.maxspeed ? " · korlát: " + escapeHtml(c.tags.maxspeed) + " km/h" : ""}</div>`)
        .addTo(poiLayers.camera);
    }
    if (L_.parking && z >= 14) for (const p of Pois.inView(Pois.cache.parking, b).slice(0, 250)) {
      const fee = p.tags.fee === "yes" ? "fizetős" : p.tags.fee === "no" ? "ingyenes" : "";
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html: `<div class="poi-pin" style="background:#0e7490">P</div>`, iconSize: null, iconAnchor: [10, 12] }) })
        .bindPopup(`<div class="pp-title">🅿️ ${escapeHtml(p.tags.name || "Parkoló")}</div>
          <div class="pp-sub">${[fee, p.tags.capacity && p.tags.capacity + " hely", p.tags.parking === "underground" && "mélygarázs", p.tags.parking === "multi-storey" && "parkolóház"].filter(Boolean).join(" · ") || "OSM parkoló"}</div>
          <div class="pp-row"><button class="pill primary" data-goto="${p.lat},${p.lng}" data-name="${escapeHtml(p.tags.name || "Parkoló")}">Navigálj ide</button></div>`)
        .addTo(poiLayers.parking);
    }
    if (L_.fuel && z >= 12) {
      const stations = Pois.inView(Pois.cache.fuel, b).slice(0, 200);
      let prices = [];
      try { prices = await Store.listFuel(stations.map(s => s.id)); } catch {}
      const latest = {};
      for (const p of prices) { latest[p.station_id] ??= {}; latest[p.station_id][p.fuel] ??= p; }
      const p95 = stations.map(s => latest[s.id]?.["95"]?.price).filter(Boolean);
      const min = p95.length ? Math.min(...p95) : null;
      for (const s of stations) {
        const pr = latest[s.id] || {};
        const v = pr["95"]?.price;
        const color = v && v === min ? "#16a34a" : "#334155";
        const brand = s.tags.brand || s.tags.name || "Benzinkút";
        const label = v ? `⛽ ${v}` : `⛽ ${escapeHtml(brand.slice(0, 10))}`;
        L.marker([s.lat, s.lng], { icon: L.divIcon({ className: "", html: `<div class="poi-pin" style="background:${color}">${label}</div>`, iconSize: null, iconAnchor: [20, 12] }), zIndexOffset: v === min ? 300 : 0 })
          .bindPopup(() => fuelPopup(s, pr))
          .addTo(poiLayers.fuel);
      }
    }
  }

  function fuelPopup(s, pr) {
    const rows = Pois.FUELS.map(([k, l]) => `<tr><td>${l}</td><td>${pr[k] ? `${pr[k].price} Ft <small>${Geo.fmtAgo(pr[k].created_at)}</small>` : "<small>nincs adat</small>"}</td></tr>`).join("");
    const inputs = Pois.FUELS.map(([k, l]) => `<input type="number" inputmode="numeric" min="300" max="1200" placeholder="${l}" data-fuel="${k}" style="width:48%;margin:2px 0;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--panel-2);color:var(--text)">`).join(" ");
    return `<div class="pp-title">⛽ ${escapeHtml(s.tags.brand || s.tags.name || "Benzinkút")}</div>
      <div class="pp-sub">${escapeHtml([s.tags.name !== s.tags.brand && s.tags.name, s.tags["addr:city"], s.tags["addr:street"]].filter(Boolean).join(", "))}</div>
      <table class="price-table">${rows}</table>
      <details style="margin-top:8px"><summary class="hint">Árak frissítése (Ft/l)</summary>${inputs}
        <div class="pp-row"><button class="pill accent" data-fuelsave="${s.id}">Mentés</button></div></details>
      <div class="pp-row"><button class="pill primary" data-goto="${s.lat},${s.lng}" data-name="${escapeHtml(s.tags.brand || "Benzinkút")}">Navigálj ide</button></div>`;
  }

  document.addEventListener("click", async e => {
    const g = e.target.closest("[data-goto]");
    if (g) { const [la, lo] = g.dataset.goto.split(",").map(Number); map.closePopup(); showPlace([la, lo], g.dataset.name); return; }
    const f = e.target.closest("[data-fuelsave]");
    if (f) {
      const box = f.closest(".leaflet-popup-content");
      const rows = [...box.querySelectorAll("[data-fuel]")].filter(i => i.value).map(i => ({ station_id: f.dataset.fuelsave, fuel: i.dataset.fuel, price: Math.round(+i.value), nick: S.settings.nick || null }));
      if (!rows.length) return toast("Írj be legalább egy árat.");
      if (rows.some(r => r.price < 300 || r.price > 1200)) return toast("Az ár 300 és 1200 Ft között legyen.");
      try { await Store.addFuel(rows); toast("Köszi, árak frissítve! ⛽"); map.closePopup(); refreshPois(); }
      catch (err) { toast("Nem sikerült menteni."); }
    }
  });

  // ================= rétegek + beállítások =================
  $("#btnLayers").onclick = () => {
    const L_ = S.settings.layers;
    const sw = (k, lbl, hint) => `<label class="switch"><span>${lbl}<br><span class="hint">${hint}</span></span><input type="checkbox" data-layer="${k}" ${L_[k] ? "checked" : ""}></label>`;
    openModal("Rétegek", `
      ${sw("reports", "🚨 Közösségi jelzések", "Rendőr, baleset, dugó, veszély, parkoló")}
      ${sw("camera", "📸 Fix traffipaxok", "OpenStreetMap adat (közelítésnél)")}
      ${sw("fuel", "⛽ Benzinkutak és árak", "A legolcsóbb 95-ös zölddel")}
      ${sw("parking", "🅿️ Parkolók", "Csak erős közelítésnél")}
      <div class="field"><label>Térkép</label>${themeSeg()}</div>`);
    document.querySelectorAll("[data-layer]").forEach(i => i.onchange = () => {
      S.settings.layers[i.dataset.layer] = i.checked; saveSettings(); renderReports(); refreshPois();
    });
    bindThemeSeg();
  };

  const themeSeg = () => `<div class="seg" id="themeSeg">${[["auto", "Automatikus"], ["light", "Világos"], ["dark", "Sötét"]]
    .map(([k, l]) => `<button data-theme="${k}" class="${S.settings.theme === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
  function bindThemeSeg() {
    document.querySelectorAll("#themeSeg button").forEach(b => b.onclick = () => {
      S.settings.theme = b.dataset.theme; saveSettings(); applyTheme();
      document.querySelectorAll("#themeSeg button").forEach(x => x.classList.toggle("on", x === b));
    });
  }

  $("#btnSettings").onclick = () => openSettings();
  function openSettings() {
    openModal("Beállítások", `
      <div class="field"><label>Beceneved (a jelzéseid mellett látszik)</label><input id="setNick" maxlength="24" value="${escapeHtml(S.settings.nick)}" placeholder="pl. Bence"></div>
      <label class="switch"><span>🔊 Hangos navigáció és figyelmeztetés</span><input type="checkbox" id="setVoice" ${S.settings.voice ? "checked" : ""}></label>
      <label class="switch"><span>Fizetős utak kerülése</span><input type="checkbox" id="setToll" ${S.settings.avoidTolls ? "checked" : ""}></label>
      <label class="switch"><span>Autópályák kerülése</span><input type="checkbox" id="setMw" ${S.settings.avoidMotorways ? "checked" : ""}></label>
      <div class="field"><label>Térkép</label>${themeSeg()}</div>
      <div class="field"><label>Mód</label>
        <div class="hint">${Store.live
          ? "● <b>Közösségi mód</b> — a jelzéseket és árakat mindenki látja, élőben."
          : "○ <b>Helyi mód</b> — a jelzések csak ezen az eszközön látszanak. Közösségi módhoz töltsd ki a Supabase adatokat a config.js-ben (README)."}</div>
      </div>
      ${Store.live ? "" : `<div class="row"><button class="pill" id="setDemo">Demo jelzések a közelbe</button></div>`}
      <p class="hint">Térkép: © OpenStreetMap közreműködők, CARTO · Útvonal: OSRM · Keresés: Nominatim</p>`);
    $("#setNick").oninput = e => { S.settings.nick = e.target.value.trim(); saveSettings(); };
    $("#setVoice").onchange = e => { S.settings.voice = e.target.checked; saveSettings(); if (e.target.checked) speak("Hang bekapcsolva."); };
    $("#setToll").onchange = e => { S.settings.avoidTolls = e.target.checked; saveSettings(); };
    $("#setMw").onchange = e => { S.settings.avoidMotorways = e.target.checked; saveSettings(); };
    bindThemeSeg();
    const demo = $("#setDemo"); if (demo) demo.onclick = addDemo;
  }

  async function addDemo() {
    const c = S.me || [map.getCenter().lat, map.getCenter().lng];
    const pick = [["police", "visible"], ["accident", "minor"], ["jam", "heavy"], ["hazard", "pothole"], ["camera", "mobile"], ["closure", "roadwork"], ["parking", "free"]];
    for (const [type, sub] of pick) {
      const a = Math.random() * Math.PI * 2, r = 0.004 + Math.random() * 0.012;
      const saved = await Store.addReport({ type, sub, lat: c[0] + Math.sin(a) * r, lng: c[1] + Math.cos(a) * r * 1.5, heading: null, note: "demo", nick: "Demo",
        expires_at: new Date(Date.now() + Reports.ttlOf(type, sub) * 60000).toISOString() });
      S.reports.set(saved.id, saved);
    }
    renderReports(); closeModal(); toast("7 demo jelzés a közeledben.");
  }

  // ================= frissítések =================
  let moveTimer;
  map.on("moveend", () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { refreshReports(); refreshPois(); }, 700); });
  $("#sheet").addEventListener("click", e => { if (e.target.classList.contains("grab")) $("#sheet").classList.toggle("mini"); });
  refreshReports(); refreshPois();

  // tesztekhez / konzolhoz
  window.Uthirnok = { S, map, onPosition, showPlace, planRoute, startSim, stopNav, refreshReports };

  // ================= frissítés-figyelés (asztali / androidos app) =================
  const platform = window.uthirnokDesktop ? "desktop" : window.Capacitor?.isNativePlatform?.() ? "android" : "web";
  const verNum = v => String(v || "").replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  const newer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function checkUpdate() {
    const cur = window.UTHIRNOK_VERSION;
    if (platform === "web" || !C.GITHUB_REPO || !cur || cur === "dev") return;
    try {
      const rel = await (await fetch(`https://api.github.com/repos/${C.GITHUB_REPO}/releases/latest`)).json();
      if (!rel.tag_name || !newer(rel.tag_name, cur)) return;
      const want = platform === "android" ? /android\.apk$/i : /telepito\.exe$/i;
      const asset = (rel.assets || []).find(a => want.test(a.name));
      const url = asset?.browser_download_url || rel.html_url;
      const t = $("#toast");
      t.innerHTML = `Új verzió: ${escapeHtml(rel.tag_name)} &nbsp;<a href="#" id="updLink" style="color:var(--accent);font-weight:800">Letöltés</a>`;
      t.classList.remove("hidden");
      clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 20000);
      $("#updLink").onclick = e => { e.preventDefault(); location.href = url; };
    } catch {}
  }
  setTimeout(checkUpdate, 4000);

  // ================= PWA =================
  if ("serviceWorker" in navigator && platform === "web") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
