// Az androidos projekt testreszabása a "npx cap add android" után:
// helyengedély, verziószám, képernyő ébren tartása.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const A = path.join(root, "android", "app");
if (!fs.existsSync(A)) { console.error("Nincs android/ mappa - elobb: npx cap add android"); process.exit(1); }

// 1) engedélyek
const manPath = path.join(A, "src", "main", "AndroidManifest.xml");
let man = fs.readFileSync(manPath, "utf8");
const perms = ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "WAKE_LOCK", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"];
for (const p of perms) {
  if (!man.includes(`android.permission.${p}"`))
    man = man.replace("</manifest>", `    <uses-permission android:name="android.permission.${p}" />\n</manifest>`);
}
if (!man.includes("android.hardware.location.gps"))
  man = man.replace("</manifest>", `    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>`);
fs.writeFileSync(manPath, man);

// 2) verzió a package.json-ből (1.2.3 -> versionCode 10203)
const [ma, mi, pa] = pkg.version.split(".").map(n => parseInt(n, 10) || 0);
const code = ma * 10000 + mi * 100 + pa;
const gPath = path.join(A, "build.gradle");
let g = fs.readFileSync(gPath, "utf8");
g = g.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`);
fs.writeFileSync(gPath, g);

// 3) navigáció közben ne aludjon el a kijelző, amíg az app elöl van
const id = require(path.join(root, "capacitor.config.json")).appId;
const mainAct = path.join(A, "src", "main", "java", ...id.split("."), "MainActivity.java");
fs.writeFileSync(mainAct, `package ${id};

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
`);
console.log(`android/ kesz: v${pkg.version} (versionCode ${code})`);
