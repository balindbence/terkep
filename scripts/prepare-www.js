// A webes fájlokat a www/ mappába másolja (ebből épül az asztali és az androidos app).
// A MapLibre-t helyi másolatra cseréli, hogy internet nélkül is elinduljon.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const www = path.join(root, "www");
const pkg = require(path.join(root, "package.json"));

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

const copy = (src, dst = src) => fs.cpSync(path.join(root, src), path.join(www, dst), { recursive: true });
["index.html", "style.css", "config.js", "manifest.webmanifest", "sw.js", "js", "icons"].forEach(f => copy(f));

const ml = path.join(root, "node_modules", "maplibre-gl", "dist");
if (!fs.existsSync(ml)) { console.error("Hianyzik a maplibre-gl - futtasd: npm install"); process.exit(1); }
fs.mkdirSync(path.join(www, "vendor", "maplibre"), { recursive: true });
for (const f of ["maplibre-gl.js", "maplibre-gl.css"]) fs.copyFileSync(path.join(ml, f), path.join(www, "vendor", "maplibre", f));

const CDN = /https:\/\/unpkg\.com\/maplibre-gl@[^/]+\/dist\//g;
for (const f of ["index.html", "sw.js"]) {
  const p = path.join(www, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(CDN, "vendor/maplibre/"));
}
fs.writeFileSync(path.join(www, "js", "version.js"), `window.UTHIRNOK_VERSION = ${JSON.stringify(pkg.version)};\n`);
console.log(`www/ kesz (v${pkg.version})`);
