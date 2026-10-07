// Úthírnök — fő alkalmazás
(async () => {
  const C = window.UTHIRNOK_CONFIG;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const T = Reports.TYPES;
  const ls = Store.ls;

  // ================= állapot =================
  const S = {
    me: null, heading: null, speed: 0, follow: true,
    settings: Object.assign({ voice: true, voiceMode: "recorded", voiceFallback: "beep", nick: "", avoidTolls: false, avoidMotorways: false, avoidUnpaved: true, theme: "auto",
      layers: { reports: true, camera: true, fuel: true, parking: false } }, ls.get("uthirnok.settings", {})),
    places: ls.get("uthirnok.places", {}),          // {home:{name,pos}, work:…, school:…}
    recent: ls.get("uthirnok.recent", []),          // [{name, sub, pos}]
    stats: ls.get("uthirnok.stats", { reports: 0, votes: 0 }),
    dest: null, destName: "", destSub: "", stops: [], addingStop: false,
    depart: { mode: "now", time: null },
    routes: [], sel: 0, nav: null,
    reports: new Map(), markers: new Map(), poiMarkers: [],
    alerted: new Map(), activeAlert: null, sim: null, fuelOnRoute: null,
  };
  const save = {
    settings: () => ls.set("uthirnok.settings", S.settings),
    places: () => ls.set("uthirnok.places", S.places),
    recent: () => ls.set("uthirnok.recent", S.recent),
    stats: () => ls.set("uthirnok.stats", S.stats),
  };
  const PLACE_LABEL = { home: ["🏠", "Otthon"], work: ["💼", "Munka"], school: ["🎓", "Suli"] };

  // ================= téma =================
  const isDark = () => {
    const t = S.settings.theme;
    if (t !== "auto") return t === "dark";
    const h = new Date().getHours(); return h >= 19 || h < 7;
  };
  function applyTheme() {
    const d = isDark();
    document.body.classList.toggle("dark", d);
    document.querySelector('meta[name="theme-color"]').content = d ? "#0d1117" : "#eef1f4";
    MapView.setDark(d);
  }
  document.body.classList.toggle("dark", isDark());

  // ================= térkép =================
  Voice.load();
  await MapView.init("map", { center: C.DEFAULT_CENTER, zoom: C.DEFAULT_ZOOM, dark: isDark() });
  setInterval(applyTheme, 5 * 60000);

  // ================= segédek =================
  let toastTimer;
  function toast(msg, ms = 2800, html = false) {
    const t = $("#toast"); t[html ? "innerHTML" : "textContent"] = msg; t.classList.remove("hidden");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  }
  let huVoice = null;
  const synth = window.speechSynthesis;
  function pickVoice() { try { huVoice = synth.getVoices().find(v => v.lang?.toLowerCase().startsWith("hu")) || null; } catch {} }
  if (synth) { pickVoice(); try { synth.onvoiceschanged = pickVoice; } catch {} }
  function speak(text) {
    if (!S.settings.voice || !synth) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "hu-HU"; if (huVoice) u.voice = huVoice; u.rate = 1.03;
      synth.speak(u);
    } catch {}
  }
  // hang: elsősorban a felvett emberi hang; ha egy mondat hiányzik → sípolás vagy gépi hang (beállítás szerint)
  function say(ids, text) {
    if (!S.settings.voice) return;
    const mode = S.settings.voiceMode;
    if (mode === "recorded" && Voice.play(ids)) return;
    if (mode === "tts" || (mode === "recorded" && S.settings.voiceFallback === "tts")) return speak(text);
    if (mode !== "off") Voice.beep(ids.includes("speeding") || ids.some(i => i?.startsWith("al_")) ? 3 : 2);
  }
  const spokenDist = m => m >= 1000 ? `${(m / 1000).toFixed(1).replace(".0", "").replace(".", ",")} kilométer` : `${Math.max(50, Math.round(m / 50) * 50)} méter`;
  const myPos = () => S.me || MapView.center();

  function setSheetH() {
    const sh = $("#sheet");
    document.documentElement.style.setProperty("--sheet-h", sh.classList.contains("hidden") ? "0px" : sh.offsetHeight + "px");
  }
  function openSheet(html) {
    $("#sheetBody").innerHTML = html; $("#sheet").classList.remove("hidden", "mini");
    document.body.classList.add("sheet-open"); requestAnimationFrame(setSheetH);
  }
  function closeSheet() { $("#sheet").classList.add("hidden"); document.body.classList.remove("sheet-open"); setSheetH(); }
  window.addEventListener("resize", setSheetH);
  $(".grab").onclick = () => { $("#sheet").classList.toggle("mini"); requestAnimationFrame(setSheetH); };

  function openModal(title, html) { $("#modalTitle").textContent = title; $("#modalBody").innerHTML = html; $("#modal").classList.remove("hidden"); }
  function closeModal() { $("#modal").classList.add("hidden"); }
  $("#modalClose").onclick = () => { if (Voice.isRecording()) Voice.stopRecording(); closeModal(); };
  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); $("#results").classList.add("hidden"); } });

  // ================= saját hely =================
  let meMarker = null;
  const meEl = document.createElement("div");
  meEl.className = "me"; meEl.innerHTML = '<div class="halo"></div><div class="ring hidden"></div><div class="dot"></div>';

  function updateMe() {
    if (!S.me) return;
    const dir = S.heading != null && (S.speed > 3 || S.nav);
    meEl.classList.toggle("dir", dir);
    meEl.querySelector(".ring").classList.toggle("hidden", !dir);
    if (!meMarker) meMarker = MapView.marker(S.me, meEl, { anchor: "center", rotationAlignment: "map", pitchAlignment: "map" });
    else meMarker.setLngLat([S.me[1], S.me[0]]);
    meMarker.setRotation(dir ? S.heading : 0);
  }

  function onPosition(lat, lng, speedMs, headingDeg) {
    const pos = [lat, lng];
    if (S.me && Geo.dist(S.me, pos) > 4 && (headingDeg == null || isNaN(headingDeg) || (speedMs ?? 0) < 1)) headingDeg = Geo.bearing(S.me, pos);
    if (headingDeg != null && !isNaN(headingDeg)) S.heading = headingDeg;
    S.me = pos; S.speed = Math.max(0, (speedMs ?? 0) * 3.6);
    updateMe();
    if (S.follow) MapView.follow(pos, S.heading, !!S.nav, S.speed);
    $("#spdVal").textContent = Math.round(S.speed);
    updateLimit();
    if (S.nav) navTick();
    checkAlerts();
  }

  function startGps() {
    if (!("geolocation" in navigator)) return ipFallback();
    navigator.geolocation.watchPosition(
      p => { if (!S.sim) onPosition(p.coords.latitude, p.coords.longitude, p.coords.speed, p.coords.heading); },
      err => { if (err.code === 1) toast("A helyhozzáférés le van tiltva — engedélyezd a beállításokban."); ipFallback(); },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  let ipTried = false;
  async function ipFallback() {
    if (ipTried || S.me) return; ipTried = true;
    try {
      const j = await (await fetch("https://ipapi.co/json/")).json();
      if (!S.me && j.latitude) MapView.map.jumpTo({ center: [j.longitude, j.latitude], zoom: 13 });
    } catch {}
  }
  startGps();
  setTimeout(() => { if (!S.me) ipFallback(); }, 8000);

  MapView.on("userpan", () => { S.follow = false; $("#btnLocate").classList.remove("on"); });
  $("#btnLocate").classList.add("on");
  $("#btnLocate").onclick = () => {
    S.follow = true; $("#btnLocate").classList.add("on");
    if (S.me) MapView.follow(S.me, S.heading, !!S.nav, S.speed); else toast("Még keresem a helyzeted…");
  };

  // ================= sebességkorlát =================
  let limitBusy = false;
  async function updateLimit() {
    if (limitBusy || !S.me || (S.speed < 8 && !S.nav)) return;
    limitBusy = true;
    const lim = await Pois.speedLimit(S.me, S.heading);
    limitBusy = false;
    $("#limit").classList.toggle("hidden", !lim);
    if (lim) $("#limitVal").textContent = lim;
    const over = !!(lim && S.speed > lim + 5);
    $("#speedo").classList.toggle("over", over);
    if (lim && S.speed > lim + 10 && S.nav && Date.now() - (S.lastSpeedWarn || 0) > 60000) { S.lastSpeedWarn = Date.now(); say(["speeding"], "Lassíts, túl gyors vagy."); }
  }

  // ================= gyorsgombok (mentett + legutóbbi helyek) =================
  function renderChips() {
    const parts = Object.entries(PLACE_LABEL).map(([k, [ico, lbl]]) =>
      `<button class="chip" data-place="${k}">${ico} ${lbl}${S.places[k] ? "" : " <small>＋</small>"}</button>`);
    S.recent.slice(0, 4).forEach((r, i) => parts.push(`<button class="chip" data-recent="${i}">🕘 ${escapeHtml(r.name.slice(0, 22))}</button>`));
    $("#chips").innerHTML = parts.join("");
  }
  renderChips();
  $("#chips").addEventListener("click", e => {
    const p = e.target.closest("[data-place]"), r = e.target.closest("[data-recent]");
    if (p) {
      const pl = S.places[p.dataset.place];
      if (pl) choosePlace(pl.pos, pl.name, PLACE_LABEL[p.dataset.place][1]);
      else toast(`Keress rá a címre, és a hely lapján mentsd el ${PLACE_LABEL[p.dataset.place][1].toLowerCase()}ként.`, 4000);
    }
    if (r) { const x = S.recent[+r.dataset.recent]; choosePlace(x.pos, x.name, x.sub); }
  });
  function addRecent(name, sub, pos) {
    S.recent = [{ name, sub, pos }, ...S.recent.filter(r => Geo.dist(r.pos, pos) > 30)].slice(0, 8);
    save.recent(); renderChips();
  }

  // ================= keresés =================
  const q = $("#q"), results = $("#results");
  let searchTimer, searchCtl, lastResults = [];
  q.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const v = q.value.trim();
    if (v.length < 3) { results.classList.add("hidden"); return; }
    searchTimer = setTimeout(() => search(v), 400);
  });
  q.addEventListener("keydown", e => {
    if (e.key === "Enter") { clearTimeout(searchTimer); if (lastResults[0]) pickResult(lastResults[0]); else search(q.value.trim(), true); }
  });
  q.addEventListener("focus", () => { if (lastResults.length && q.value.trim().length >= 3) results.classList.remove("hidden"); });
  const TYPE_ICO = { fuel: "⛽", parking: "🅿️", restaurant: "🍽️", cafe: "☕", supermarket: "🛒", school: "🎓", hospital: "🏥", pharmacy: "💊", railway: "🚆", station: "🚆", bus_stop: "🚌", city: "🏙️", town: "🏘️", village: "🏡", house: "🏠", residential: "🛣️" };
  async function search(v, pickFirst = false) {
    const coord = v.match(/^\s*(-?\d+[.,]\d+)[\s,;]+(-?\d+[.,]\d+)\s*$/);
    if (coord) return pickResult({ lat: +coord[1].replace(",", "."), lon: +coord[2].replace(",", "."), display_name: "Koordináta" });
    searchCtl?.abort(); searchCtl = new AbortController();
    const c = myPos();
    const vb = `${c[1] - 1.5},${c[0] + 1},${c[1] + 1.5},${c[0] - 1}`;
    try {
      const url = `${C.NOMINATIM_URL}/search?format=jsonv2&addressdetails=1&limit=7&accept-language=hu&viewbox=${vb}&q=${encodeURIComponent(v)}`;
      const res = await fetch(url, { signal: searchCtl.signal });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      lastResults = data;
      if (pickFirst && data[0]) return pickResult(data[0]);
      results.innerHTML = data.length ? data.map((r, i) => {
        const [first, ...rest] = r.display_name.split(", ");
        const d = S.me ? Geo.fmtDist(Geo.dist(S.me, [+r.lat, +r.lon])) : "";
        return `<li data-i="${i}"><span class="r-ico">${TYPE_ICO[r.type] || TYPE_ICO[r.category] || "📍"}</span>
          <span style="min-width:0"><b>${escapeHtml(r.name || first)}</b><small>${escapeHtml(rest.slice(0, 3).join(", "))}</small></span>
          <span class="r-dist">${d}</span></li>`;
      }).join("") : `<li><small>Nincs találat. Próbáld településnévvel együtt (pl. „Kossuth utca 5, Bicske”).</small></li>`;
      results.classList.remove("hidden");
    } catch (e) { if (e.name !== "AbortError") toast("A kereső most nem elérhető. Van internet?"); }
  }
  results.addEventListener("click", e => { const li = e.target.closest("li[data-i]"); if (li) pickResult(lastResults[+li.dataset.i]); });
  function pickResult(r) {
    results.classList.add("hidden"); q.blur();
    const parts = r.display_name.split(", ");
    const name = r.name || parts[0];
    const sub = parts.slice(1, 4).join(", ");
    choosePlace([+r.lat, +r.lon], name, sub);
  }

  function choosePlace(pos, name, sub = "") {
    if (S.addingStop && S.dest) {
      S.addingStop = false; S.stops.push({ pos, name });
      q.value = ""; toast(`Megálló hozzáadva: ${name}`); planRoute(); return;
    }
    addRecent(name, sub, pos);
    showPlace(pos, name, sub);
  }

  // ================= jelölők: cél és megállók =================
  let destMarker = null, stopMarkers = [];
  function drawDestMarkers() {
    destMarker?.remove(); destMarker = null;
    stopMarkers.forEach(m => m.remove()); stopMarkers = [];
    if (S.dest) { const el = document.createElement("div"); el.className = "dest-pin"; destMarker = MapView.marker(S.dest, el, { anchor: "center" }); }
    S.stops.forEach(s => { const el = document.createElement("div"); el.className = "stop-pin"; stopMarkers.push(MapView.marker(s.pos, el, { anchor: "center" })); });
  }

  function showPlace(pos, name, sub = "") {
    S.dest = pos; S.destName = name; S.destSub = sub; S.stops = [];
    drawDestMarkers();
    S.follow = false; $("#btnLocate").classList.remove("on");
    MapView.map.easeTo({ center: [pos[1], pos[0]], zoom: 16, pitch: 0, bearing: 0, duration: 700,
      padding: { bottom: window.innerWidth >= 900 ? 0 : 220, top: 0, left: window.innerWidth >= 900 ? 420 : 0, right: 0 } });
    const d = S.me ? Geo.fmtDist(Geo.dist(S.me, pos)) : "";
    openSheet(`
      <p class="s-title">${escapeHtml(name)}</p>
      <p class="s-sub">${escapeHtml(sub)}${sub && d ? " · " : ""}${d}</p>
      <div class="row"><button class="btn primary" id="goRoute">Útvonal</button><button class="btn" id="goSave">☆ Mentés</button><button class="btn" id="goClose">Bezár</button></div>`);
    $("#goRoute").onclick = () => planRoute();
    $("#goClose").onclick = clearAll;
    $("#goSave").onclick = () => {
      openModal("Mentés mint…", `<div class="row" style="flex-direction:column">${Object.entries(PLACE_LABEL).map(([k, [ico, l]]) =>
        `<button class="btn" data-saveas="${k}" style="text-align:left">${ico} ${l}${S.places[k] ? ` <small class="hint">(most: ${escapeHtml(S.places[k].name)})</small>` : ""}</button>`).join("")}</div>`);
      $$("[data-saveas]").forEach(b => b.onclick = () => {
        S.places[b.dataset.saveas] = { name, pos }; save.places(); renderChips(); closeModal();
        toast(`Elmentve: ${PLACE_LABEL[b.dataset.saveas][1]}`);
      });
    };
  }

  // jobb klikk / hosszú nyomás
  let ctxPopup = null;
  MapView.on("contextmenu", p => {
    ctxPopup?.remove();
    ctxPopup = MapView.popup(p, `<div class="ctx">
        <button class="btn primary" data-ctx="go">🧭 Navigálj ide</button>
        ${S.dest && !S.nav ? '<button class="btn" data-ctx="stop">➕ Megálló ide</button>' : ""}
        <button class="btn" data-ctx="rep">⚠️ Jelzés ide</button></div>`, { offset: 6 });
    ctxPopup.getElement().addEventListener("click", e => {
      const b = e.target.closest("[data-ctx]"); if (!b) return;
      ctxPopup.remove();
      const name = "Kijelölt pont", sub = `${p[0].toFixed(5)}, ${p[1].toFixed(5)}`;
      if (b.dataset.ctx === "go") showPlace(p, name, sub);
      if (b.dataset.ctx === "stop") { S.stops.push({ pos: p, name: "Megálló" }); planRoute(); }
      if (b.dataset.ctx === "rep") openReport(p);
    });
  });

  function clearAll() {
    stopNav(false); stopSim();
    MapView.clearRoute(); S.routes = []; S.dest = null; S.stops = []; S.fuelOnRoute = null;
    drawDestMarkers(); closeSheet(); q.value = "";
    MapView.resetView();
  }

  // ================= útvonaltervezés =================
  async function ensureReportsAround(line) {
    let s = 90, w = 180, n = -90, e = -180;
    for (const [la, lo] of line) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
    try { (await Store.listReports({ s: s - .01, w: w - .01, n: n + .01, e: e + .01 })).forEach(r => S.reports.set(r.id, r)); renderReports(); } catch {}
  }

  const routeOpts = () => ({ avoidTolls: S.settings.avoidTolls, avoidMotorways: S.settings.avoidMotorways, avoidUnpaved: S.settings.avoidUnpaved });

  async function planRoute() {
    if (!S.dest) return;
    let from = S.me;
    if (!from) { from = MapView.center(); toast("Nincs GPS — a térkép közepéről tervezek."); }
    S.planFrom = from;
    drawDestMarkers();
    openSheet(`<p class="s-title">Útvonalak keresése…</p><p class="s-sub">A közösségi jelzéseket is figyelembe veszem.</p>`);
    try {
      const pts = [from, ...S.stops.map(s => s.pos), S.dest];
      const routes = await Routing.route(pts, routeOpts());
      await ensureReportsAround(routes[0].line);
      const active = [...S.reports.values()];
      routes.forEach(rt => { const x = Reports.onRoute(active, rt); rt.hits = x.hits; rt.penalty = x.penalty; rt.score = rt.duration + x.penalty; });
      routes.sort((a, b) => a.score - b.score);
      S.routes = routes; S.sel = 0; S.fuelOnRoute = null;
      drawRoutes(true); showRouteSheet();
      findFuelOnRoute(routes[0]);
    } catch (e) {
      openSheet(`<p class="s-title">Nem sikerült</p><p class="s-sub">${escapeHtml(e.message)}</p>
        <div class="row"><button class="btn primary" id="retry">Újra</button><button class="btn" id="goClose">Bezár</button></div>`);
      $("#retry").onclick = planRoute; $("#goClose").onclick = clearAll;
    }
  }

  function drawRoutes(fit) {
    const rt = S.routes[S.sel]; if (!rt) return;
    const alts = S.routes.filter((_, i) => i !== S.sel).map(r => r.line);
    MapView.setRoute(Reports.trafficSegments(rt, rt.hits || []), alts);
    if (fit) {
      S.follow = false; $("#btnLocate").classList.remove("on");
      const wide = window.innerWidth >= 900;
      MapView.fit(S.routes.flatMap(r => r.line.filter((_, i) => i % 5 === 0)),
        { top: 90, bottom: wide ? 40 : Math.min(window.innerHeight * 0.55, 420), left: wide ? 450 : 40, right: 70 });
    }
  }
  MapView.on("altclick", i => {
    if (S.nav) return;
    const alts = S.routes.map((_, k) => k).filter(k => k !== S.sel);
    S.sel = alts[i] ?? S.sel; drawRoutes(); showRouteSheet();
  });

  function trafficBar(rt) {
    const segs = Reports.trafficSegments(rt, rt.hits || []);
    const total = rt.cum[rt.cum.length - 1];
    return `<div class="tbar">${segs.map(s => `<i style="flex:${((s.b - s.a) / total).toFixed(4)};background:${s.color}"></i>`).join("")}</div>`;
  }

  function hitTags(hits) {
    const by = {};
    hits.forEach(r => { by[r.type] = (by[r.type] || 0) + 1; });
    return Object.entries(by).map(([t, n]) => `<span class="tag ${t === "police" || t === "camera" ? "blue" : "warn"}">${T[t].ico} ${n > 1 ? n + " " : ""}${T[t].label.toLowerCase()}</span>`).join("");
  }

  function timeInfo(rt) {
    const dur = rt.score * 1000;
    const m = S.depart.mode;
    const now = Date.now();
    let t = S.depart.time ? new Date(S.depart.time) : null;
    if (m === "later" && t) return { line: `indulás ${Geo.fmtClock(t)} · érkezés ${Geo.fmtClock(new Date(+t + dur))}` };
    if (m === "arrive" && t) {
      const dep = new Date(+t - dur);
      return { line: dep < now ? `már késésben vagy · ${Math.round((now - dep) / 60000)} perc` : `indulj ${Geo.fmtClock(dep)}-kor`, late: dep < now };
    }
    return { line: `érkezés ${Geo.fmtClock(new Date(now + dur))}` };
  }

  function showRouteSheet() {
    const nowPlus = new Date(Date.now() + 30 * 60000);
    const defTime = `${String(nowPlus.getHours()).padStart(2, "0")}:${String(nowPlus.getMinutes()).padStart(2, "0")}`;
    const tval = S.depart.time ? Geo.fmtClock(new Date(S.depart.time)) : defTime;
    const stops = [`<div class="stop"><i class="dot"></i><span>${S.me ? "Saját hely" : "Térkép közepe"}</span></div>`,
      ...S.stops.map((s, i) => `<div class="stop"><i class="dot"></i><span>${i + 1}. ${escapeHtml(s.name)}</span>
        ${i > 0 ? `<button data-upstop="${i}" aria-label="Feljebb">↑</button>` : ""}<button data-rmstop="${i}" aria-label="Törlés">×</button></div>`),
      `<div class="stop"><i class="dot end"></i><span><b>${escapeHtml(S.destName || "Úti cél")}</b></span></div>`].join("");
    const rows = S.routes.map((rt, i) => {
      const ti = timeInfo(rt);
      return `<button class="rt ${i === S.sel ? "sel" : ""}" data-r="${i}">
        <div class="tt">${Geo.fmtDur(rt.score).replace(" perc", " p")}</div>
        <div class="meta"><b>${rt.roads.length ? escapeHtml(rt.roads.join(", ")) : Geo.fmtDist(rt.distance)}</b>
          <small>${Geo.fmtDist(rt.distance)} · ${ti.line}</small>
          ${trafficBar(rt)}
          <div>${i === 0 && S.routes.length > 1 ? '<span class="tag ok">Leggyorsabb</span>' : ""}${rt.penalty >= 60 ? `<span class="tag warn">+${Math.round(rt.penalty / 60)} p jelzések miatt</span>` : ""}${hitTags(rt.hits)}${!rt.hits.length ? '<span class="tag">nincs jelzés</span>' : ""}${rt.engine === "osrm" && S.settings.avoidUnpaved ? '<span class="tag warn">földutak most nincsenek kizárva</span>' : ""}</div>
        </div><div class="radio"></div></button>`;
    }).join("");
    const f = S.fuelOnRoute;
    const fuelHtml = f ? `<div class="extra">⛽ <span>Legolcsóbb az úton: <b>${escapeHtml(f.brand)}</b> ${f.price} Ft${f.detour > 30 ? ` · +${Math.round(f.detour / 60)} p` : ""}</span><button class="go" id="addFuel">Megálló</button></div>` : "";
    openSheet(`
      <div class="stops">${stops}</div>
      <div class="row" style="gap:14px;flex:none"><button class="addstop" id="addStop" style="flex:none">＋ Megálló hozzáadása</button>
        ${S.stops.length >= 2 ? '<button class="addstop" id="optStops" style="flex:none">⇅ Legjobb sorrend</button>' : ""}</div>
      <div class="seg" id="departSeg">
        <button data-m="now" class="${S.depart.mode === "now" ? "on" : ""}">Indulás most</button>
        <button data-m="later" class="${S.depart.mode === "later" ? "on" : ""}">Később</button>
        <button data-m="arrive" class="${S.depart.mode === "arrive" ? "on" : ""}">Érkezés ekkorra</button>
      </div>
      ${S.depart.mode !== "now" ? `<div class="timepick">${S.depart.mode === "later" ? "Indulás:" : "Érkezzek:"} <input type="time" id="departTime" value="${tval}"></div>` : ""}
      <div>${rows}</div>
      ${fuelHtml}
      <div class="row" style="margin-top:12px"><button class="btn primary" id="goNav">Indulás</button></div>
      <div class="row opts-row" style="margin-top:8px">
        <button class="btn small" id="optDirt">${S.settings.avoidUnpaved ? "✓ " : ""}Földút nélkül</button>
        <button class="btn small" id="optToll">${S.settings.avoidTolls ? "✓ " : ""}Fizetős nélkül</button>
        <button class="btn small" id="optMw">${S.settings.avoidMotorways ? "✓ " : ""}Autópálya nélkül</button>
        <button class="btn small" id="goSim" title="Kipróbálás GPS nélkül">Szimuláció</button>
        <button class="btn small" id="goClose">Mégse</button>
      </div>`);
    $$(".rt").forEach(b => b.onclick = () => { S.sel = +b.dataset.r; drawRoutes(); showRouteSheet(); findFuelOnRoute(S.routes[S.sel]); });
    $$("[data-rmstop]").forEach(b => b.onclick = () => { S.stops.splice(+b.dataset.rmstop, 1); planRoute(); });
    $$("[data-upstop]").forEach(b => b.onclick = () => { const i = +b.dataset.upstop; [S.stops[i - 1], S.stops[i]] = [S.stops[i], S.stops[i - 1]]; planRoute(); });
    const os = $("#optStops");
    if (os) os.onclick = async () => {
      os.disabled = true; os.textContent = "Számolom…";
      try {
        const pts = [S.planFrom || myPos(), ...S.stops.map(x => x.pos), S.dest];
        const order = await Routing.optimize(pts);
        const inner = order.filter(i => i > 0 && i < pts.length - 1).map(i => S.stops[i - 1]);
        if (inner.length === S.stops.length) S.stops = inner;
        toast("Megállók sorrendje optimalizálva"); planRoute();
      } catch (e) { toast(e.message || "Most nem sikerült optimalizálni."); os.disabled = false; os.textContent = "⇅ Legjobb sorrend"; }
    };
    $("#addStop").onclick = () => { S.addingStop = true; q.value = ""; $("#sheet").classList.add("mini"); setSheetH(); q.focus(); toast("Keresd meg a megállót", 2500); };
    $$("#departSeg button").forEach(b => b.onclick = () => {
      S.depart.mode = b.dataset.m;
      if (b.dataset.m !== "now" && !S.depart.time) S.depart.time = +nowPlus;
      if (b.dataset.m === "now") S.depart.time = null;
      showRouteSheet();
    });
    const tp = $("#departTime");
    if (tp) tp.onchange = () => {
      const [h, m] = tp.value.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0);
      if (S.depart.mode === "later" && d < Date.now() - 60000) d.setDate(d.getDate() + 1);
      S.depart.time = +d; showRouteSheet();
    };
    $("#optDirt").onclick = () => { S.settings.avoidUnpaved = !S.settings.avoidUnpaved; save.settings(); planRoute(); };
    $("#optToll").onclick = () => { S.settings.avoidTolls = !S.settings.avoidTolls; save.settings(); planRoute(); };
    $("#optMw").onclick = () => { S.settings.avoidMotorways = !S.settings.avoidMotorways; save.settings(); planRoute(); };
    $("#goNav").onclick = () => startNav();
    $("#goSim").onclick = () => startSim();
    $("#goClose").onclick = clearAll;
    const af = $("#addFuel");
    if (af) af.onclick = () => {
      S.stops.splice(0, 0, { pos: f.pos, name: `⛽ ${f.brand}` });
      // megállók sorrendje: az útvonal mentén
      const rt = S.routes[S.sel];
      S.stops.sort((a, b) => Geo.nearestOnLine(a.pos, rt.line).i - Geo.nearestOnLine(b.pos, rt.line).i);
      planRoute();
    };
  }

  // legolcsóbb benzinkút az útvonal mentén (300 m-en belül)
  async function findFuelOnRoute(rt) {
    if (!rt) return;
    const pts = rt.line;
    let s = 90, w = 180, n = -90, e = -180;
    for (const [la, lo] of pts) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
    if ((n - s) * (e - w) > 1.2) return;          // nagyon hosszú útnál ne terheljük az Overpasst
    try { await Pois.load({ s, w, n, e }, ["fuel"]); } catch { return; }
    const near = Pois.inView(Pois.cache.fuel, { s: s - .005, w: w - .005, n: n + .005, e: e + .005 })
      .map(f => ({ f, nn: Geo.nearestOnLine([f.lat, f.lng], pts) })).filter(x => x.nn.d < 300);
    if (!near.length) return;
    let prices = [];
    try { prices = await Store.listFuel(near.map(x => x.f.id)); } catch {}
    const latest = {};
    for (const p of prices) if (p.fuel === "95" && !latest[p.station_id]) latest[p.station_id] = p.price;
    const cands = near.filter(x => latest[x.f.id]).map(x => ({ pos: [x.f.lat, x.f.lng], brand: x.f.tags.brand || x.f.tags.name || "Benzinkút", price: latest[x.f.id], detour: x.nn.d * 2 / 8 }));
    if (!cands.length) return;
    cands.sort((a, b) => a.price - b.price);
    if (S.routes[S.sel] !== rt || S.nav) return;
    S.fuelOnRoute = cands[0]; showRouteSheet();
  }

  // ================= navigáció =================
  let wakeLock = null;
  async function startNav() {
    const rt = S.routes[S.sel]; if (!rt) return;
    S.routes = [rt]; S.sel = 0;
    S.nav = { rt, idx: 0, offCount: 0, spoken: new Set(), lastReroute: 0, routeAlong: new Map(), along: 0, tick: 0, parkOffered: false };
    S.alerted.clear();
    drawRoutes();
    S.follow = true; $("#btnLocate").classList.add("on");
    document.body.classList.add("navigating");
    $("#maneuver").classList.remove("hidden");
    $("#btnVoice").classList.remove("hidden"); updateVoiceBtn();
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
    say(["start"], `Indulás. ${Geo.fmtDur(rt.score)} az út.`);
    if (S.me) { MapView.follow(S.me, S.heading, true, S.speed); navTick(); } else renderNavSheet(rt.distance);
  }

  function stopNav(cleanup = true) {
    if (!S.nav) return;
    S.nav = null;
    document.body.classList.remove("navigating");
    $("#maneuver").classList.add("hidden"); $("#lanes").classList.add("hidden");
    $("#btnVoice").classList.add("hidden");
    hideAlert();
    try { wakeLock?.release(); } catch {} wakeLock = null;
    MapView.resetView();
    if (cleanup) { stopSim(); MapView.clearRoute(); closeSheet(); S.dest = null; S.stops = []; drawDestMarkers(); }
  }

  function renderNavSheet(remaining) {
    const rt = S.nav.rt;
    const total = rt.cum[rt.cum.length - 1];
    const remSec = rt.score * (remaining / total);
    const segs = Reports.trafficSegments(rt, rt.hits || [], total - remaining);
    const bar = `<div class="prog">${segs.map(s => `<i style="flex:${((s.b - s.a) / Math.max(1, remaining)).toFixed(4)};background:${s.color}"></i>`).join("")}</div>`;
    const html = `
      <div class="nav-row keep"><div><div class="t">${Geo.fmtClock(new Date(Date.now() + remSec * 1000))}</div><small>${Geo.fmtDur(remSec)} · ${Geo.fmtDist(remaining)}</small></div>
        <button class="btn danger small" id="navStop">Vége</button></div>
      ${bar}
      <div class="nav-actions">
        <button class="btn" id="navShare">📤 Érkezés megosztása</button>
        <button class="btn" id="navPark">🅿️ Parkoló a célnál</button>
      </div>`;
    if ($("#navStop")) $("#sheetBody").innerHTML = html; else openSheet(html);
    $("#navStop").onclick = () => { stopNav(); say(["end"], "Navigáció vége."); };
    $("#navShare").onclick = () => shareEta(remSec);
    $("#navPark").onclick = () => parkingNearDest(true);
  }

  async function shareEta(remSec) {
    const eta = Geo.fmtClock(new Date(Date.now() + remSec * 1000));
    const d = S.dest;
    const text = `Úton vagyok ide: ${S.destName || "úti cél"}. Várható érkezés: ${eta}.`;
    const url = `https://www.openstreetmap.org/?mlat=${d[0].toFixed(5)}&mlon=${d[1].toFixed(5)}#map=16/${d[0].toFixed(5)}/${d[1].toFixed(5)}`;
    try {
      if (navigator.share) await navigator.share({ title: "Úthírnök", text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); toast("Vágólapra másolva — illeszd be üzenetbe."); }
    } catch {}
  }

  async function parkingNearDest(manual) {
    if (!S.dest) return;
    const d = S.dest, r = 0.006;
    try { await Pois.load({ s: d[0] - r, w: d[1] - r * 1.5, n: d[0] + r, e: d[1] + r * 1.5 }, ["parking"]); } catch { if (manual) toast("A parkolók most nem érhetők el."); return; }
    const list = Pois.inView(Pois.cache.parking, { s: d[0] - r, w: d[1] - r * 1.5, n: d[0] + r, e: d[1] + r * 1.5 })
      .map(p => ({ p, dist: Geo.dist(d, [p.lat, p.lng]) })).sort((a, b) => a.dist - b.dist).slice(0, 5);
    const free = [...S.reports.values()].filter(x => x.type === "parking" && x.sub !== "full" && Geo.dist(d, [x.lat, x.lng]) < 600);
    if (!list.length && !free.length) { if (manual) toast("Nem találtam parkolót a cél közelében."); return; }
    if (!manual) { toast(`🅿️ ${list.length + free.length} parkoló a cél közelében — koppints a 🅿️ gombra`, 5000); say(["parking"], "Parkolót találtam a cél közelében."); return; }
    const row = (name, sub, pos) => `<button class="rt" data-park="${pos[0]},${pos[1]}" data-name="${escapeHtml(name)}"><div class="meta"><b>${escapeHtml(name)}</b><small>${sub}</small></div><span class="tag blue">Ide</span></button>`;
    openModal("Parkolás a cél közelében", `<p class="m-sub">${escapeHtml(S.destName || "")}</p>
      ${free.map(x => row("Szabad hely (jelzés)", `${Geo.fmtDist(Geo.dist(d, [x.lat, x.lng]))} · ${Geo.fmtAgo(x.created_at)}`, [x.lat, x.lng])).join("")}
      ${list.map(({ p, dist }) => row(p.tags.name || "Parkoló", [Geo.fmtDist(dist), p.tags.fee === "yes" ? "fizetős" : p.tags.fee === "no" ? "ingyenes" : "", p.tags.capacity && p.tags.capacity + " hely", p.tags.parking === "multi-storey" ? "parkolóház" : p.tags.parking === "underground" ? "mélygarázs" : ""].filter(Boolean).join(" · "), [p.lat, p.lng])).join("")}`);
    $$("[data-park]").forEach(b => b.onclick = async () => {
      const [la, lo] = b.dataset.park.split(",").map(Number);
      closeModal(); S.dest = [la, lo]; S.destName = b.dataset.name; drawDestMarkers();
      if (S.nav) await reroute(true); else planRoute();
    });
  }

  function lanesHtml(lanes) {
    return lanes.map(l => `<span class="${l.on ? "on" : ""}">${Routing.svgArrow(l.arrow, 20)}</span>`).join("");
  }

  function navTick() {
    const nav = S.nav; if (!nav || !S.me) return;
    const rt = nav.rt;
    const pr = Routing.progress(rt, S.me, nav.idx);
    nav.idx = pr.idx; nav.along = pr.along; nav.tick++;

    if (pr.off > 50) { if (++nav.offCount >= 3 && Date.now() - nav.lastReroute > 12000) { reroute(); return; } }
    else nav.offCount = 0;

    const total = rt.cum[rt.cum.length - 1];
    const remaining = Math.max(0, total - pr.along);
    if (remaining < 30) { say(["arrive"], "Megérkeztél az úti célhoz."); toast("🏁 Megérkeztél!", 4000); stopNav(); return; }

    const si = rt.steps.findIndex(s => s.along > pr.along + 8);
    const step = rt.steps[si] || rt.steps[rt.steps.length - 1];
    const next = rt.steps[si + 1];
    const dNext = Math.max(0, step.along - pr.along);
    $("#mvArrow").innerHTML = Routing.svgArrow(step.arrow);
    $("#mvDist").textContent = Geo.fmtDist(dNext);
    $("#mvInstr").textContent = step.text + (step.name && step.type !== "arrive" ? ` · ${step.name}` : "");
    $("#mvInstr").title = step.text;
    const showThen = next && next.along - step.along < 600;
    $("#mvThen").classList.toggle("hidden", !showThen);
    if (showThen) $("#mvThenArrow").innerHTML = Routing.svgArrow(next.arrow, 22);
    const showLanes = step.lanes && dNext < 900;
    $("#lanes").classList.toggle("hidden", !showLanes);
    if (showLanes) $("#lanes").innerHTML = lanesHtml(step.lanes);

    const ths = S.speed > 75 ? [1500, 500, 90] : [600, 200, 40];
    for (const th of ths) {
      const key = `${si}:${th}`;
      if (dNext <= th && !nav.spoken.has(key)) {
        ths.forEach(t => { if (t >= th) nav.spoken.add(`${si}:${t}`); });
        const pre = th === ths[2] ? "" : `${spokenDist(dNext)} múlva `;
        let sayText = step.say || `${step.text.toLowerCase()}${step.name ? ", " + step.name : ""}`;
        if (th === ths[2] && showThen) sayText += `, utána ${(next.say || next.text).toLowerCase()}`;
        const ids = [th === ths[2] ? null : Voice.distClip(dNext), step.key];
        if (th === ths[2] && showThen && next.key) ids.push("then", next.key);
        say(ids, pre + sayText);
        break;
      }
    }
    if (!nav.parkOffered && remaining < 1500) { nav.parkOffered = true; parkingNearDest(false); }
    if (nav.tick % 10 === 0) MapView.setRoute(Reports.trafficSegments(rt, rt.hits || [], pr.along), []);
    renderNavSheet(remaining);
  }

  async function reroute(quiet) {
    const nav = S.nav; if (!nav) return;
    nav.lastReroute = Date.now(); nav.offCount = 0;
    if (!quiet) { toast("Útvonal újratervezése…"); say(["reroute"], "Újratervezés."); }
    try {
      // a már elhagyott megállókat kihagyjuk
      const rest = S.stops.filter(s => Geo.nearestOnLine(s.pos, nav.rt.line).i > nav.idx);
      S.stops = rest;
      const [rt] = await Routing.route([S.me || MapView.center(), ...rest.map(s => s.pos), S.dest], { ...routeOpts(), alternatives: false });
      if (!S.nav) return;
      const x = Reports.onRoute([...S.reports.values()], rt); rt.hits = x.hits; rt.penalty = x.penalty; rt.score = rt.duration + x.penalty;
      Object.assign(nav, { rt, idx: 0, spoken: new Set(), routeAlong: new Map() });
      S.routes = [rt]; S.sel = 0; drawRoutes(); drawDestMarkers();
      if (S.sim) { S.sim.rt = rt; S.sim.d = 0; }
    } catch { toast("Nem sikerült újratervezni."); }
  }

  function updateVoiceBtn() {
    $("#btnVoice").classList.toggle("on", S.settings.voice);
    $("#voiceIco").innerHTML = S.settings.voice ? '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>' : '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>';
  }
  $("#btnVoice").onclick = () => { S.settings.voice = !S.settings.voice; save.settings(); updateVoiceBtn(); if (!S.settings.voice) { try { synth.cancel(); } catch {} Voice.stop(); } toast(S.settings.voice ? "Hang bekapcsolva" : "Hang kikapcsolva"); };

  // ================= szimuláció =================
  function startSim() {
    const rt = S.routes[S.sel]; if (!rt) return;
    stopSim();
    const kmh = 60;
    S.sim = { rt, d: 0, timer: null };
    onPosition(rt.line[0][0], rt.line[0][1], 0, Geo.bearing(rt.line[0], rt.line[1] || rt.line[0]));
    startNav();
    S.sim.timer = setInterval(() => {
      const sim = S.sim; if (!sim) return;
      const r = sim.rt;
      sim.d += kmh / 3.6 * 1.5;
      const total = r.cum[r.cum.length - 1];
      if (sim.d >= total) sim.d = total;
      let i = r.cum.findIndex(c => c > sim.d) - 1; if (i < 0) i = r.cum.length - 2;
      const t = (sim.d - r.cum[i]) / ((r.cum[i + 1] - r.cum[i]) || 1);
      const a = r.line[i], b = r.line[i + 1];
      onPosition(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, kmh / 3.6, Geo.bearing(a, b));
      if (sim.d >= total) stopSim();
    }, 1000);
    toast("Szimuláció: 60 km/h-val végigmegy az útvonalon.");
  }
  function stopSim() { if (S.sim) { clearInterval(S.sim.timer); S.sim = null; } }

  // ================= közösségi jelzések a térképen =================
  function renderReports() {
    const show = S.settings.layers.reports;
    const keep = new Set();
    for (const r of S.reports.values()) {
      if (!show || Reports.isHidden(r) || new Date(r.expires_at) < new Date()) continue;
      keep.add(r.id);
      if (!S.markers.has(r.id)) {
        const el = Reports.iconEl(r);
        const m = MapView.marker([r.lat, r.lng], el, { anchor: "bottom" });
        el.addEventListener("click", ev => { ev.stopPropagation(); MapView.popup([r.lat, r.lng], Reports.popupHtml(S.reports.get(r.id) || r), { offset: 40 }); });
        S.markers.set(r.id, m);
      }
    }
    for (const [id, m] of S.markers) if (!keep.has(id)) { m.remove(); S.markers.delete(id); }
  }

  async function refreshReports() {
    try {
      const list = await Store.listReports(MapView.bounds(0.6));
      const now = new Date();
      for (const [id, r] of S.reports) if (new Date(r.expires_at) < now) S.reports.delete(id);
      list.forEach(r => S.reports.set(r.id, r));
      renderReports();
    } catch (e) { console.warn(e); }
  }
  setInterval(refreshReports, C.POLL_MS);

  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-vote]"); if (!b) return;
    await doVote(b.dataset.id, +b.dataset.vote);
    $$(".maplibregl-popup").forEach(p => p.remove());
  });
  async function doVote(id, val) {
    const r = S.reports.get(id); if (!r) return;
    try {
      const ok = await Store.vote(id, val, Reports.ttlOf(r.type, r.sub));
      if (!ok) { toast("Erre már szavaztál."); return; }
      if (val > 0) r.up++; else r.down++;
      S.stats.votes++; save.stats();
      toast(val > 0 ? "Köszi, megerősítve 👍" : "Köszi, jelezve hogy eltűnt");
      renderReports(); refreshReports();
    } catch { toast("A szavazás nem sikerült."); }
  }

  // ----- jelzés beküldése -----
  $("#btnReport").onclick = () => openReport(null);
  const SOFT = { police: "#e6efff", camera: "#f1e9ff", accident: "#ffe7ea", jam: "#fff1e3", closure: "#ffe4e4", hazard: "#fff6dc", parking: "#e1f4f8" };

  function openReport(point) {
    const dark = document.body.classList.contains("dark");
    const tiles = Object.entries(T).map(([k, t]) =>
      `<button class="tile" data-t="${k}"><div class="c" style="background:${dark ? t.color + "33" : SOFT[k]}">${t.ico}</div>${t.label}</button>`).join("")
      + `<button class="tile" data-t="fuelprice"><div class="c" style="background:${dark ? "#16a34a33" : "#e3f7e8"}">⛽</div>Benzinár</button>`;
    openModal("Jelzés", `<p class="m-sub">${point ? "A kijelölt pontra kerül." : S.me ? "A jelenlegi helyedre kerül, menetirányban." : "Nincs GPS — a térkép közepére kerül."}
      ${Store.live ? "" : "<br>Helyi mód: csak ezen az eszközön látszik."}</p><div class="grid4">${tiles}</div>`);
    $$(".tile[data-t]").forEach(b => b.onclick = () => b.dataset.t === "fuelprice" ? fuelPriceNearby() : openReportDetail(b.dataset.t, point));
  }

  // két koppintás: típus → altípus = elküldve (vezetés közben ez kell)
  function openReportDetail(type, point) {
    const t = T[type];
    openModal(`${t.ico} ${t.label}`, `
      <p class="m-sub">Koppints, és már megy is.</p>
      <div class="subs big">${t.subs.map(([k, l]) => `<button data-s="${k}">${l}</button>`).join("")}</div>
      ${S.nav ? "" : `<div class="field"><label>Megjegyzés (nem kötelező, a küldés előtt írd be)</label><input id="repNote" maxlength="120" placeholder="pl. a benzinkút után, jobb sávban"></div>`}`);
    $$(".subs button").forEach(b => b.onclick = () => sendReport(type, b.dataset.s, point, b));
  }

  async function sendReport(type, sub, point, btn) {
    const t = T[type];
    const pos = point || myPos();
    const ttl = Reports.ttlOf(type, sub);
    const row = { type, sub, lat: pos[0], lng: pos[1], heading: S.heading == null ? null : Math.round(S.heading),
      note: $("#repNote")?.value.trim().slice(0, 120) || null, nick: S.settings.nick || null,
      expires_at: new Date(Date.now() + ttl * 60000).toISOString() };
    $$(".subs button").forEach(x => x.disabled = true);
    if (btn) btn.classList.add("on");
    try {
      const saved = await Store.addReport(row);
      S.reports.set(saved.id, saved);
      ls.set("uthirnok.votes", { ...ls.get("uthirnok.votes", {}), [saved.id]: 1 });
      S.alerted.set(saved.id, "passed");
      S.stats.reports++; save.stats();
      renderReports(); closeModal();
      toast(`${t.ico} Köszi! ${ttl >= 1440 ? Math.round(ttl / 1440) + " napig" : ttl >= 60 ? Math.round(ttl / 60) + " óráig" : ttl + " percig"} látszik.`);
      if (S.nav && ["jam", "accident", "closure"].includes(type)) { const x = Reports.onRoute([...S.reports.values()], S.nav.rt); S.nav.rt.hits = x.hits; }
    } catch (e) { toast("Nem sikerült elküldeni: " + e.message); $$(".subs button").forEach(x => x.disabled = false); }
  }

  // benzinár beírása a legközelebbi kúthoz
  async function fuelPriceNearby() {
    const p = myPos(), r = 0.01;
    openModal("⛽ Benzinár", `<p class="m-sub">Benzinkutak keresése a közelben…</p>`);
    try { await Pois.load({ s: p[0] - r, w: p[1] - r * 1.5, n: p[0] + r, e: p[1] + r * 1.5 }, ["fuel"]); } catch {}
    const list = Pois.inView(Pois.cache.fuel, { s: p[0] - r, w: p[1] - r * 1.5, n: p[0] + r, e: p[1] + r * 1.5 })
      .map(f => ({ f, d: Geo.dist(p, [f.lat, f.lng]) })).sort((a, b) => a.d - b.d).slice(0, 6);
    if (!list.length) { $("#modalBody").innerHTML = `<p class="m-sub">Nem találtam benzinkutat 1 km-en belül. A térképen a kútra koppintva is beírhatod az árat.</p>`; return; }
    $("#modalBody").innerHTML = `<p class="m-sub">Melyik kútnál vagy?</p>` + list.map(({ f, d }) =>
      `<button class="rt" data-fs="${f.id}"><div class="meta"><b>${escapeHtml(f.tags.brand || f.tags.name || "Benzinkút")}</b><small>${Geo.fmtDist(d)}${f.tags["addr:street"] ? " · " + escapeHtml(f.tags["addr:street"]) : ""}</small></div></button>`).join("");
    $$("[data-fs]").forEach(b => b.onclick = async () => {
      const f = Pois.cache.fuel.get(b.dataset.fs);
      const pr = await latestPrices(f.id);
      $("#modalBody").innerHTML = fuelHtml(f, pr, false);
    });
  }

  // ================= figyelmeztetések =================
  function alertCandidates() {
    const out = [];
    for (const r of S.reports.values()) {
      if (Reports.isHidden(r) || !T[r.type]?.warn || r.sub === "other_side") continue;
      out.push({ id: r.id, lat: r.lat, lng: r.lng, type: r.type, sub: r.sub, user: true, warn: T[r.type].warn, ups: r.up });
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
        else if (state === "warned" && air < 120) ahead = -air;
      }
      if (ahead == null) continue;

      if (!state && ahead > 0 && ahead < c.warn) {
        S.alerted.set(c.id, "warned");
        const t = T[c.type];
        const lbl = c.user ? t.label : `Fix traffipax${c.limit ? ` · ${c.limit}` : ""}`;
        say([c.user ? "al_" + c.type : "al_camera"], `Figyelem! ${spokenDist(ahead)} múlva ${c.user ? t.label.toLowerCase() : "traffipax"}.`);
        best = { c, ahead, lbl };
      } else if (state === "warned" && ahead < -25) {
        S.alerted.set(c.id, "passed");
        if (c.user && Store.myVote(c.id) === 0) askStillThere(c);
        else if (S.activeAlert?.c.id === c.id) hideAlert();
      } else if (state === "warned" && S.activeAlert?.c.id === c.id && ahead > 0) {
        S.activeAlert.ahead = ahead;
        $("#alSub").textContent = `${Geo.fmtDist(ahead)}${c.user && c.ups > 1 ? ` · ${c.ups} megerősítés` : ""}`;
        $("#alBarFill").style.width = `${Math.min(100, (1 - ahead / c.warn) * 100)}%`;
      }
    }
    if (best && (!S.activeAlert || best.ahead < S.activeAlert.ahead)) showAlert(best);
  }

  let alertTimer;
  function showAlert(a) {
    S.activeAlert = a;
    const t = T[a.c.type];
    $("#alIco").textContent = t.ico;
    $("#alIco").style.background = document.body.classList.contains("dark") ? t.color + "33" : SOFT[a.c.type];
    $("#alTitle").textContent = a.lbl;
    $("#alSub").textContent = `${Geo.fmtDist(a.ahead)}${a.c.user && a.c.ups > 1 ? ` · ${a.c.ups} megerősítés` : ""}`;
    $("#alBar").classList.remove("hidden");
    $("#alBarFill").style.width = `${Math.min(100, (1 - a.ahead / a.c.warn) * 100)}%`;
    $("#alActions").classList.add("hidden");
    $("#alert").classList.remove("hidden");
    clearTimeout(alertTimer); alertTimer = setTimeout(hideAlert, 90000);
  }
  function askStillThere(c) {
    const t = T[c.type];
    S.activeAlert = { c, ahead: 0 };
    $("#alIco").textContent = t.ico;
    $("#alTitle").textContent = `${t.label}: még ott van?`;
    $("#alSub").textContent = "";
    $("#alBar").classList.add("hidden");
    $("#alActions").classList.remove("hidden");
    $("#alert").classList.remove("hidden");
    say(["still"], `${t.label}: még ott van?`);
    $("#alYes").onclick = () => { doVote(c.id, 1); hideAlert(); };
    $("#alNo").onclick = () => { doVote(c.id, -1); hideAlert(); };
    clearTimeout(alertTimer); alertTimer = setTimeout(hideAlert, 12000);
  }
  function hideAlert() { $("#alert").classList.add("hidden"); S.activeAlert = null; }

  // ================= OSM rétegek =================
  async function latestPrices(stationId) {
    let prices = [];
    try { prices = await Store.listFuel([stationId]); } catch {}
    const out = {};
    for (const p of prices) out[p.fuel] ??= p;
    return out;
  }
  function fuelHtml(s, pr, withNav = true) {
    const rows = Pois.FUELS.map(([k, l]) => `<tr><td>${l}</td><td>${pr[k] ? `${pr[k].price} Ft <small>${Geo.fmtAgo(pr[k].created_at)}</small>` : "<small>nincs adat</small>"}</td></tr>`).join("");
    const inputs = Pois.FUELS.map(([k, l]) => `<input type="number" inputmode="numeric" min="300" max="1200" placeholder="${l}" data-fuel="${k}">`).join("");
    return `<div class="pp-title">⛽ ${escapeHtml(s.tags.brand || s.tags.name || "Benzinkút")}</div>
      <div class="pp-sub">${escapeHtml([s.tags.name !== s.tags.brand && s.tags.name, s.tags["addr:city"], s.tags["addr:street"]].filter(Boolean).join(", ")) || "&nbsp;"}</div>
      <table class="prices">${rows}</table>
      <div class="price-in">${inputs}</div>
      <div class="pp-row"><button class="btn primary" data-fuelsave="${s.id}">Árak mentése</button>
      ${withNav ? `<button class="btn" data-goto="${s.lat},${s.lng}" data-name="${escapeHtml(s.tags.brand || "Benzinkút")}">Ide</button>` : ""}</div>`;
  }

  async function refreshPois() {
    const z = MapView.map.getZoom(), b = MapView.bounds();
    const L_ = S.settings.layers, kinds = [];
    if ((L_.camera || S.nav) && z >= 10) kinds.push("camera");
    if (L_.fuel && z >= 12) kinds.push("fuel");
    if (L_.parking && z >= 14) kinds.push("parking");
    try { await Pois.load(b, kinds); } catch (e) { console.warn(e); }
    renderPois(b, z);
  }

  const poiEl = (html, bg, click) => {
    const el = document.createElement("div");
    el.className = "poi"; el.style.background = bg; el.innerHTML = html;
    el.addEventListener("click", ev => { ev.stopPropagation(); click(); });
    return el;
  };
  async function renderPois(b, z) {
    const L_ = S.settings.layers;
    S.poiMarkers.forEach(m => m.remove()); S.poiMarkers = [];
    const add = (pos, el) => S.poiMarkers.push(MapView.marker(pos, el, { anchor: "center" }));
    if (L_.camera && z >= 10) for (const c of Pois.inView(Pois.cache.camera, b).slice(0, 200))
      add([c.lat, c.lng], poiEl(`📸${c.tags.maxspeed ? " " + escapeHtml(c.tags.maxspeed) : ""}`, "#7c3aed",
        () => MapView.popup([c.lat, c.lng], `<div class="pp-title">📸 Fix traffipax</div><div class="pp-sub">OpenStreetMap adat${c.tags.maxspeed ? " · korlát: " + escapeHtml(c.tags.maxspeed) + " km/h" : ""}</div>`)));
    if (L_.parking && z >= 14) for (const p of Pois.inView(Pois.cache.parking, b).slice(0, 150)) {
      const fee = p.tags.fee === "yes" ? "fizetős" : p.tags.fee === "no" ? "ingyenes" : "";
      add([p.lat, p.lng], poiEl("P", "#0e7490", () => MapView.popup([p.lat, p.lng], `<div class="pp-title">🅿️ ${escapeHtml(p.tags.name || "Parkoló")}</div>
        <div class="pp-sub">${[fee, p.tags.capacity && p.tags.capacity + " hely", p.tags.parking === "underground" && "mélygarázs", p.tags.parking === "multi-storey" && "parkolóház"].filter(Boolean).join(" · ") || "OSM parkoló"}</div>
        <div class="pp-row"><button class="btn primary" data-goto="${p.lat},${p.lng}" data-name="${escapeHtml(p.tags.name || "Parkoló")}">Navigálj ide</button></div>`)));
    }
    if (L_.fuel && z >= 12) {
      const stations = Pois.inView(Pois.cache.fuel, b).slice(0, 150);
      let prices = [];
      try { prices = await Store.listFuel(stations.map(s => s.id)); } catch {}
      const latest = {};
      for (const p of prices) { latest[p.station_id] ??= {}; latest[p.station_id][p.fuel] ??= p; }
      const p95 = stations.map(s => latest[s.id]?.["95"]?.price).filter(Boolean);
      const min = p95.length ? Math.min(...p95) : null;
      for (const s of stations) {
        const pr = latest[s.id] || {}, v = pr["95"]?.price;
        const brand = s.tags.brand || s.tags.name || "Kút";
        add([s.lat, s.lng], poiEl(v ? `⛽ ${v}` : `⛽ ${escapeHtml(brand.slice(0, 9))}`, v && v === min ? "#16a34a" : "#475569",
          () => MapView.popup([s.lat, s.lng], fuelHtml(s, pr))));
      }
    }
  }

  document.addEventListener("click", async e => {
    const g = e.target.closest("[data-goto]");
    if (g) { const [la, lo] = g.dataset.goto.split(",").map(Number); $$(".maplibregl-popup").forEach(p => p.remove()); choosePlace([la, lo], g.dataset.name); return; }
    const f = e.target.closest("[data-fuelsave]");
    if (f) {
      const box = f.closest(".maplibregl-popup-content, .modal-card");
      const rows = [...box.querySelectorAll("[data-fuel]")].filter(i => i.value).map(i => ({ station_id: f.dataset.fuelsave, fuel: i.dataset.fuel, price: Math.round(+i.value), nick: S.settings.nick || null }));
      if (!rows.length) return toast("Írj be legalább egy árat.");
      if (rows.some(r => r.price < 300 || r.price > 1200)) return toast("Az ár 300 és 1200 Ft között legyen.");
      try {
        await Store.addFuel(rows); S.stats.reports++; save.stats();
        toast("Köszi, árak frissítve ⛽"); $$(".maplibregl-popup").forEach(p => p.remove()); closeModal(); refreshPois();
      } catch { toast("Nem sikerült menteni."); }
    }
  });

  // ================= rétegek + beállítások =================
  const themeSeg = () => `<div class="seg" id="themeSeg">${[["auto", "Automatikus"], ["light", "Világos"], ["dark", "Sötét"]]
    .map(([k, l]) => `<button data-theme="${k}" class="${S.settings.theme === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
  function bindThemeSeg() {
    $$("#themeSeg button").forEach(b => b.onclick = () => {
      S.settings.theme = b.dataset.theme; save.settings(); applyTheme();
      $$("#themeSeg button").forEach(x => x.classList.toggle("on", x === b));
      if (S.routes.length) drawRoutes();
    });
  }

  $("#btnLayers").onclick = () => {
    const L_ = S.settings.layers;
    const sw = (k, lbl, hint) => `<label class="switch"><span>${lbl}<span class="hint">${hint}</span></span><input type="checkbox" data-layer="${k}" ${L_[k] ? "checked" : ""}></label>`;
    openModal("Térkép", `
      ${sw("reports", "🚨 Közösségi jelzések", "Rendőr, baleset, dugó, veszély, parkoló")}
      ${sw("camera", "📸 Fix traffipaxok", "OpenStreetMap adat, közelítésnél")}
      ${sw("fuel", "⛽ Benzinkutak és árak", "A legolcsóbb 95-ös zölddel")}
      ${sw("parking", "🅿️ Parkolók", "Csak erős közelítésnél")}
      <div class="field"><label>Megjelenés</label>${themeSeg()}</div>`);
    $$("[data-layer]").forEach(i => i.onchange = () => { S.settings.layers[i.dataset.layer] = i.checked; save.settings(); renderReports(); refreshPois(); });
    bindThemeSeg();
  };

  $("#btnSettings").onclick = () => openSettings();
  function openSettings() {
    const placesHtml = Object.entries(PLACE_LABEL).map(([k, [ico, l]]) => S.places[k]
      ? `<div class="switch"><span>${ico} ${l}<span class="hint">${escapeHtml(S.places[k].name)}</span></span><button class="btn small" data-delplace="${k}">Törlés</button></div>` : "").join("");
    openModal("Beállítások", `
      <div class="stat"><div><b>${S.stats.reports}</b><small>jelzésed</small></div><div><b>${S.stats.votes}</b><small>megerősítésed</small></div></div>
      <div class="field"><label>Beceneved (a jelzéseid mellett látszik)</label><input id="setNick" maxlength="24" value="${escapeHtml(S.settings.nick)}" placeholder="pl. Bence"></div>
      <label class="switch"><span>🔊 Hangos navigáció és figyelmeztetés</span><input type="checkbox" id="setVoice" ${S.settings.voice ? "checked" : ""}></label>
      <div class="field"><label>Milyen hangon szóljon?</label>
        <div class="seg" id="voiceSeg">${[["recorded", "Felvett emberi hang"], ["tts", "Gépi hang"]].map(([k, l]) => `<button data-vm="${k}" class="${S.settings.voiceMode === k ? "on" : ""}">${l}</button>`).join("")}</div>
        ${S.settings.voiceMode === "recorded" ? `<button class="btn" id="openRec">🎙️ Hang felvétele · ${Voice.count()}/${Voice.PHRASES.length} kész</button>
        <label class="hint" style="display:flex;gap:8px;align-items:center;margin-top:6px">Ha egy mondat nincs felvéve:
          <select id="voiceFb" style="background:var(--soft);border:0;border-radius:8px;padding:6px"><option value="beep" ${S.settings.voiceFallback === "beep" ? "selected" : ""}>sípoljon</option><option value="tts" ${S.settings.voiceFallback === "tts" ? "selected" : ""}>gépi hang</option></select></label>` : ""}
      </div>
      <label class="switch"><span>Burkolatlan utak (földutak) kerülése<span class="hint">Valhalla útvonaltervezővel</span></span><input type="checkbox" id="setDirt" ${S.settings.avoidUnpaved ? "checked" : ""}></label>
      <label class="switch"><span>Fizetős utak kerülése</span><input type="checkbox" id="setToll" ${S.settings.avoidTolls ? "checked" : ""}></label>
      <label class="switch"><span>Autópályák kerülése</span><input type="checkbox" id="setMw" ${S.settings.avoidMotorways ? "checked" : ""}></label>
      ${placesHtml}
      <div class="field"><label>Megjelenés</label>${themeSeg()}</div>
      <p class="hint">${Store.live ? "● <b>Közösségi mód</b>: a jelzéseket és árakat mindenki látja, élőben."
        : "○ <b>Helyi mód</b>: a jelzések csak ezen az eszközön látszanak. Közösségi módhoz töltsd ki a Supabase adatokat a config.js-ben (README)."}</p>
      ${Store.live ? "" : `<div class="row"><button class="btn small" id="setDemo">Demo jelzések a közelbe</button></div>`}
      <p class="hint">Verzió: ${escapeHtml(window.UTHIRNOK_VERSION || "dev")} · Térkép: ${MapView.usingFallback ? "OpenStreetMap (tartalék)" : "OpenFreeMap"} · © OpenStreetMap közreműködők · Útvonal: OSRM · Keresés: Nominatim</p>`);
    $("#setNick").oninput = e => { S.settings.nick = e.target.value.trim(); save.settings(); };
    $("#setVoice").onchange = e => { S.settings.voice = e.target.checked; save.settings(); updateVoiceBtn(); if (e.target.checked) say(["start"], "Hang bekapcsolva."); };
    $$("#voiceSeg button").forEach(b => b.onclick = () => { S.settings.voiceMode = b.dataset.vm; save.settings(); openSettings(); });
    const fb = $("#voiceFb"); if (fb) fb.onchange = () => { S.settings.voiceFallback = fb.value; save.settings(); };
    const orb = $("#openRec"); if (orb) orb.onclick = () => openRecorder();
    $("#setDirt").onchange = e => { S.settings.avoidUnpaved = e.target.checked; save.settings(); };
    $("#setToll").onchange = e => { S.settings.avoidTolls = e.target.checked; save.settings(); };
    $("#setMw").onchange = e => { S.settings.avoidMotorways = e.target.checked; save.settings(); };
    $$("[data-delplace]").forEach(b => b.onclick = () => { delete S.places[b.dataset.delplace]; save.places(); renderChips(); openSettings(); });
    bindThemeSeg();
    const demo = $("#setDemo"); if (demo) demo.onclick = addDemo;
  }

  // ================= hangfelvevő =================
  function openRecorder() {
    const groups = Voice.GROUPS.map(([g, list]) => `<p class="rec-g">${g}</p>` + list.map(([id, text]) => `
      <div class="rec-row" data-id="${id}">
        <span class="rec-ok">${Voice.has(id) ? "✓" : ""}</span>
        <span class="rec-t">${escapeHtml(text)}</span>
        <button class="rec-b play" data-play="${id}" ${Voice.has(id) ? "" : "disabled"} aria-label="Lejátszás">▶</button>
        <button class="rec-b rec" data-rec="${id}" aria-label="Felvétel">●</button>
      </div>`).join("")).join("");
    openModal("Hang felvétele", `
      <p class="m-sub">Nyomd meg a ● gombot, mondd ki a mondatot, majd nyomd meg újra. A csendet az app levágja.
        Csendes helyen, a mikrofonhoz közel, természetes hangon. A haverod is felveheti, és át is küldhetitek egymásnak.</p>
      <div class="stat"><div><b id="recCount">${Voice.count()}/${Voice.PHRASES.length}</b><small>mondat kész</small></div>
        <div><button class="btn small" id="recTest" style="width:100%">▶ Próba</button><small>„300 m múlva, fordulj jobbra”</small></div></div>
      <div class="rec-list">${groups}</div>
      <div class="row" style="margin-top:12px">
        <button class="btn small" id="recExport">📤 Csomag mentése</button>
        <label class="btn small" style="cursor:pointer">📥 Betöltés<input type="file" id="recImport" accept=".json,application/json" hidden></label>
        <button class="btn small danger" id="recClear">Törlés</button>
      </div>`);
    const refresh = id => {
      const row = document.querySelector(`.rec-row[data-id="${id}"]`); if (!row) return;
      row.querySelector(".rec-ok").textContent = Voice.has(id) ? "✓" : "";
      row.querySelector("[data-play]").disabled = !Voice.has(id);
      $("#recCount").textContent = `${Voice.count()}/${Voice.PHRASES.length}`;
    };
    $$("[data-play]").forEach(b => b.onclick = () => Voice.play([b.dataset.play]));
    $$("[data-rec]").forEach(b => b.onclick = async () => {
      const id = b.dataset.rec;
      if (Voice.isRecording()) {
        if (!b.classList.contains("on")) return toast("Előbb állítsd le az előző felvételt.");
        b.classList.remove("on"); b.textContent = "…";
        const blob = await Voice.stopRecording();
        b.textContent = "●";
        if (blob && blob.size > 200) { await Voice.put(id, blob); refresh(id); Voice.play([id]); }
        else toast("Nem sikerült felvenni, próbáld újra.");
        return;
      }
      try { await Voice.startRecording(); b.classList.add("on"); b.textContent = "■"; }
      catch (e) { toast("Nem érem el a mikrofont — engedélyezd a beállításokban."); }
    });
    $("#recTest").onclick = () => { if (!Voice.play(["d300", "turn_right"])) toast("Ehhez a „300 méter múlva” és a „fordulj jobbra” kell."); };
    $("#recExport").onclick = async () => {
      if (!Voice.count()) return toast("Még nincs felvett mondat.");
      const blob = await Voice.exportPack(S.settings.nick ? `${S.settings.nick} hangja` : "Saját hang");
      const file = new File([blob], "uthirnok-hang.json", { type: "application/json" });
      try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "Úthírnök hangcsomag" }); return; } } catch {}
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "uthirnok-hang.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    $("#recImport").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const r = await Voice.importPack(f); toast(`Betöltve: ${r.name} (${r.n} mondat)`); openRecorder(); }
      catch (err) { toast(err.message || "Nem sikerült betölteni."); }
    };
    $("#recClear").onclick = async () => {
      const b = $("#recClear");
      if (b.dataset.sure) { await Voice.clear(); openRecorder(); toast("Felvett hang törölve."); }
      else { b.dataset.sure = 1; b.textContent = "Biztos?"; }
    };
  }

  async function addDemo() {
    const c = myPos();
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
  MapView.on("moveend", () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { refreshReports(); refreshPois(); }, 700); });
  MapView.onReady(() => { refreshReports(); refreshPois(); });

  // ================= frissítés-figyelés (asztali / androidos app) =================
  const platform = window.uthirnokDesktop ? "desktop" : window.Capacitor?.isNativePlatform?.() ? "android" : "web";
  const verNum = v => String(v || "").replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  const newer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  async function checkUpdate() {
    const cur = window.UTHIRNOK_VERSION;
    if (platform === "web" || !C.GITHUB_REPO || !cur || cur === "dev") return;
    try {
      const rel = await (await fetch(`https://api.github.com/repos/${C.GITHUB_REPO}/releases/latest`)).json();
      if (!rel.tag_name || !newer(rel.tag_name, cur)) return;
      const want = platform === "android" ? /android\.apk$/i : /telepito\.exe$/i;
      const asset = (rel.assets || []).find(a => want.test(a.name));
      const url = asset?.browser_download_url || rel.html_url;
      toast(`Új verzió: ${escapeHtml(rel.tag_name)} &nbsp;<a href="#" id="updLink">Letöltés</a>`, 20000, true);
      $("#updLink").onclick = e => { e.preventDefault(); location.href = url; };
    } catch {}
  }
  setTimeout(checkUpdate, 4000);

  // tesztekhez / konzolhoz
  window.Uthirnok = { S, MapView, onPosition, showPlace, choosePlace, planRoute, startSim, stopNav, refreshReports };

  if ("serviceWorker" in navigator && platform === "web" && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
