// A webes fájlokat a www/ mappába másolja (ebből épül az asztali és az androidos app).
// A Leafletet helyi másolatra cseréli, hogy internet nélkül is elinduljon.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const www = path.join(root, "www");
const pkg = require(path.join(root, "package.json"));

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

const copy = (src, dst = src) => fs.cpSync(path.join(root, src), path.join(www, dst), { recursive: true });
["index.html", "style.css", "config.js", "manifest.webmanifest", "sw.js", "js", "icons"].forEach(f => copy(f));

const leaflet = path.join(root, "node_modules", "leaflet", "dist");
if (!fs.existsSync(leaflet)) { console.error("Hianyzik a leaflet - futtasd: npm install"); process.exit(1); }
fs.cpSync(leaflet, path.join(www, "vendor", "leaflet"), { recursive: true });

const CDN = "https://unpkg.com/leaflet@1.9.4/dist/";
for (const f of ["index.html", "sw.js"]) {
  const p = path.join(www, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").split(CDN).join("vendor/leaflet/"));
}
fs.writeFileSync(path.join(www, "js", "version.js"), `window.UTHIRNOK_VERSION = ${JSON.stringify(pkg.version)};\n`);
console.log(`www/ kesz (v${pkg.version})`);
