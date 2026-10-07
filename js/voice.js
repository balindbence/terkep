// Hangcsomag: emberi hangon felvett magyar navigációs mondatok (mint a Waze "saját hang" funkciója).
// A mondatokat a felhasználó veszi fel a mikrofonnal; az app levágja a csendet, WAV-ként tárolja
// (IndexedDB), és navigáció közben összefűzve játssza le: "300 méter múlva" + "fordulj jobbra".
const Voice = (() => {
  // ---------- a felveendő mondatok ----------
  const GROUPS = [
    ["Távolságok", [
      ["d100", "100 méter múlva"], ["d200", "200 méter múlva"], ["d300", "300 méter múlva"], ["d400", "400 méter múlva"],
      ["d500", "500 méter múlva"], ["d800", "800 méter múlva"], ["d1000", "1 kilométer múlva"], ["d1500", "másfél kilométer múlva"],
      ["d2000", "2 kilométer múlva"], ["then", "utána"],
    ]],
    ["Kanyarok", [
      ["turn_right", "fordulj jobbra"], ["turn_left", "fordulj balra"], ["keep_right", "tarts jobbra"], ["keep_left", "tarts balra"],
      ["sharp_right", "fordulj élesen jobbra"], ["sharp_left", "fordulj élesen balra"], ["uturn", "fordulj vissza"],
      ["straight", "haladj egyenesen"], ["merge", "sorolj be"],
      ["ramp_right", "hajts fel jobbra"], ["ramp_left", "hajts fel balra"], ["exit_right", "hajts le jobbra"], ["exit_left", "hajts le balra"],
    ]],
    ["Körforgalom", [
      ["rb_1", "a körforgalomban hajts ki az első kijáraton"], ["rb_2", "a körforgalomban hajts ki a második kijáraton"],
      ["rb_3", "a körforgalomban hajts ki a harmadik kijáraton"], ["rb_4", "a körforgalomban hajts ki a negyedik kijáraton"],
      ["rb_5", "a körforgalomban hajts ki az ötödik kijáraton"], ["rb", "hajts be a körforgalomba"],
    ]],
    ["Érkezés, indulás", [
      ["start", "Indulunk!"], ["arrive", "Megérkeztél!"], ["arrive_soon", "megérkezel"], ["arrive_stop", "megérkezel a megállóhoz"],
      ["reroute", "Új útvonalat tervezek"], ["end", "Navigáció vége"], ["parking", "Parkolót találtam a cél közelében"],
    ]],
    ["Figyelmeztetések", [
      ["al_police", "Figyelem, rendőr előtted!"], ["al_camera", "Figyelem, traffipax!"], ["al_accident", "Baleset előtted"],
      ["al_jam", "Dugó előtted"], ["al_closure", "Útépítés előtted"], ["al_hazard", "Vigyázz, veszély az úton!"],
      ["speeding", "Lassíts, túl gyors vagy!"], ["al_toll", "Fizetős szakasz jön, nincs rá matricád!"], ["still", "Még ott van? Koppints!"],
    ]],
  ];
  const PHRASES = GROUPS.flatMap(([g, list]) => list.map(([id, text]) => ({ id, text, group: g })));
  const TEXT = Object.fromEntries(PHRASES.map(p => [p.id, p.text]));
  const DISTS = [100, 200, 300, 400, 500, 800, 1000, 1500, 2000];

  // ---------- IndexedDB ----------
  let dbp;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("uthirnok-voice", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("clips");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction("clips", mode); const st = t.objectStore("clips"); const out = fn(st); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };
  const cache = new Map();   // id -> Blob
  async function load() {
    try {
      await tx("readonly", st => { const c = st.openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { cache.set(cur.key, cur.value); cur.continue(); } }; return null; });
    } catch (e) { console.warn("Hangcsomag nem tölthető:", e); }
  }
  async function put(id, blob) { cache.set(id, blob); await tx("readwrite", st => st.put(blob, id)); }
  async function del(id) { cache.delete(id); await tx("readwrite", st => st.delete(id)); }
  async function clear() { cache.clear(); await tx("readwrite", st => st.clear()); }
  const has = id => cache.has(id);
  const count = () => PHRASES.filter(p => cache.has(p.id)).length;

  // ---------- lejátszás ----------
  let queue = [], playing = false, current = null;
  function playBlob(blob) {
    return new Promise(res => {
      const url = URL.createObjectURL(blob);
      const a = new Audio(url); current = a;
      const done = () => { URL.revokeObjectURL(url); res(); };
      a.onended = done; a.onerror = done;
      a.play().catch(done);
    });
  }
  async function pump() {
    if (playing) return; playing = true;
    while (queue.length) {
      const ids = queue.shift();
      for (const id of ids) { const b = cache.get(id); if (b) await playBlob(b); }
      await new Promise(r => setTimeout(r, 120));
    }
    playing = false; current = null;
  }
  // true, ha minden kell darab fel van véve és lejátssza; különben false (a hívó dönt a tartalékról)
  function play(ids) {
    ids = ids.filter(Boolean);
    if (!ids.length || !ids.every(has)) return false;
    // ha sok várakozik, a régieket eldobjuk (ne késve mondja a kanyart)
    if (queue.length > 1) queue = queue.slice(-1);
    queue.push(ids); pump();
    return true;
  }
  function stop() { queue = []; try { current?.pause(); } catch {} }

  // távolság → legközelebbi felvett távolság-mondat
  function distClip(m) {
    if (m == null || m < 70) return null;
    let best = DISTS[0];
    for (const d of DISTS) if (Math.abs(d - m) < Math.abs(best - m)) best = d;
    return "d" + best;
  }

  // ---------- sípolás (ha nincs se felvett hang, se gépi hang) ----------
  let actx;
  function beep(n = 2) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < n; i++) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
        const t = actx.currentTime + i * 0.22;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.start(t); o.stop(t + 0.18);
      }
    } catch {}
  }

  // ---------- felvétel ----------
  let rec = null;
  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const chunks = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(res => mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(chunks, { type: mr.mimeType || "audio/webm" })); });
    mr.start();
    rec = { mr, done };
  }
  async function stopRecording() {
    if (!rec) return null;
    const r = rec; rec = null;
    r.mr.stop();
    const raw = await r.done;
    try { return await trimToWav(raw); } catch (e) { console.warn("Csend-levágás nem sikerült:", e); return raw; }
  }
  const isRecording = () => !!rec;

  // csend levágása az elejéről/végéről + hangerő-normalizálás, mono 16 bites WAV-ba
  async function trimToWav(blob) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close?.();
    const sr = buf.sampleRate, ch = buf.numberOfChannels;
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / ch; }
    let peak = 0; for (const v of mono) peak = Math.max(peak, Math.abs(v));
    const th = Math.max(0.015, peak * 0.08);
    let a = 0, b = mono.length - 1;
    while (a < b && Math.abs(mono[a]) < th) a++;
    while (b > a && Math.abs(mono[b]) < th) b--;
    a = Math.max(0, a - Math.round(sr * 0.06)); b = Math.min(mono.length - 1, b + Math.round(sr * 0.12));
    const gain = peak > 0 ? Math.min(4, 0.9 / peak) : 1;
    const out = mono.subarray(a, b + 1);
    const view = new DataView(new ArrayBuffer(44 + out.length * 2));
    const w = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); view.setUint32(4, 36 + out.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sr, true);
    view.setUint32(28, sr * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); w(36, "data"); view.setUint32(40, out.length * 2, true);
    for (let i = 0; i < out.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, out[i] * gain)) * 0x7fff, true);
    return new Blob([view], { type: "audio/wav" });
  }

  // ---------- csomag export / import (megosztható a haverokkal) ----------
  const b64 = async blob => { const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  async function exportPack(name) {
    const clips = {};
    for (const [id, blob] of cache) clips[id] = { type: blob.type, data: await b64(blob) };
    return new Blob([JSON.stringify({ format: "uthirnok-voice-1", name: name || "Saját hang", created: new Date().toISOString(), clips })], { type: "application/json" });
  }
  async function importPack(file) {
    const j = JSON.parse(await file.text());
    if (j.format !== "uthirnok-voice-1" || !j.clips) throw new Error("Ez nem Úthírnök hangcsomag.");
    let n = 0;
    for (const [id, c] of Object.entries(j.clips)) {
      if (!TEXT[id]) continue;
      const bin = atob(c.data), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      await put(id, new Blob([u8], { type: c.type || "audio/wav" })); n++;
    }
    return { n, name: j.name };
  }

  return { GROUPS, PHRASES, TEXT, load, put, del, clear, has, count, play, stop, distClip, beep, startRecording, stopRecording, isRecording, playBlob, exportPack, importPack };
})();
