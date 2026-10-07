# Úthírnök

Navigációs app közösségi jelzésekkel. Androidon és gépen is fut (PWA: telepíthető, mint egy rendes app).

## Mit tud

- **Vektoros térkép** (MapLibre + OpenFreeMap, kulcs nélkül), navigáció közben **menetirányba forgó, döntött 3D nézet**; éjjel magától sötét. Ha a térképszerver nem elérhető, OpenStreetMap tartalékra vált, és kiírja a hibát
- **Keresés** (Nominatim), **mentett helyek** (Otthon, Munka, Suli) és legutóbbiak gyorsgombként
- **Útvonaltervezés** (Valhalla, tartaléknak OSRM) **bármennyi megállóval** (20 fölött szakaszokra bontva), megállók átrendezése és **„Legjobb sorrend”** optimalizálás, **földutak (burkolatlan utak) kizárása**, fizetős utak / autópálya kerülése. A jelzések **beleszámítanak**: ha dugó, baleset vagy lezárás van az egyik úton, a másikat ajánlja előre, és az útvonal **forgalom szerint színezve** látszik
- **Indulás most / Később / Érkezés ekkorra**: megmondja, mikor indulj
- **Útköltség + e-matrica figyelő**: útvonalanként benzinköltség (saját fogyasztással és árral), a fizetős szakaszok hossza és **vármegyéi**, és ha nincs rá érvényes matricád, a legolcsóbb megoldás (napi / 10 napos / havi / vármegyei / M1 regionális / éves) 2026-os árakkal, plusz hogy mennyivel tartana fizetős nélkül. Navigáció közben 2 km-rel a fizetős szakasz előtt szól. Beállítások → Autóm / Matricám. (Az árak a `js/costs.js` elején írhatók át.)
- **Legolcsóbb benzinkút az útvonal mentén**, egy gombbal megállónak veszi
- **Saját, emberi hangon felvett magyar navigációs hang** (mint a Waze-ben): Beállítások → Hang felvétele. 44 rövid mondat („300 méter múlva”, „fordulj jobbra”, „Figyelem, rendőr előtted!”…), az app levágja a csendet és összefűzve mondja. A csomag elmenthető és átküldhető (📤 / 📥). Ha egy mondat hiányzik: sípol (vagy kérésre gépi hang).
- **Navigáció** hangos utasításokkal, **sávjelzéssel**, „utána” kanyarral, újratervezéssel, ébren tartott kijelzővel
- **Parkoló a célnál**: a cél előtt felajánlja a közeli parkolókat; **érkezés megosztása** üzenetben
- **Jelzések** (Waze-szerűen, **két koppintással**): rendőr, traffipax (mobil/fix/szakasz/piros lámpás), baleset, dugó, útlezárás/útépítés, veszély (kátyú, tárgy, álló jármű, állat, jég, köd, víz, hó), szabad parkoló
  - mindegyik típusnak saját élettartama van (dugó 30 perc, kátyú 7 nap…)
  - **„Még ott van?”** kérdés, miután elhaladtál mellette → megerősítés meghosszabbítja, 2 nemleges szavazattal több → eltűnik
  - **hangos figyelmeztetés** előre („Figyelem! 500 méter múlva rendőr”)
- **Fix traffipaxok** az OpenStreetMapből, rájuk is figyelmeztet
- **Sebességmérő + sebességkorlát** (OSM), piros, ha túl gyorsan mész
- **Benzinkutak árakkal**: bárki beírhatja a 95/100/dízel/LPG árat, a legolcsóbb 95-ös zölddel látszik
- **Parkolók** (fizetős/ingyenes, férőhely, parkolóház)
- **Szimuláció**: gépen GPS nélkül végig tudod „vezetni” az útvonalat, kipróbálni a figyelmeztetéseket
- Hosszú nyomás / jobb klikk a térképen: „Navigálj ide”, „Megálló ide” vagy „Jelzés ide”

## Letöltés

**Ha csak használni akarod:** a GitHub repó **Releases** oldaláról töltsd le a legfrissebbet:

| Fájl | Hova |
|---|---|
| `Uthirnok-…-telepito.exe` | Windows — telepítő, asztali ikonnal és Start menüvel |
| `Uthirnok-…-hordozhato.exe` | Windows — telepítés nélkül, pendrive-ról is fut |
| `Uthirnok-…-android.apk` | Android telefon |

**Windows:** a kék ablaknál (nincs aláírva) **További információ → Futtatás mindenképp.** Elég egyszer.

**Android:** nyisd meg az APK-t a telefonon → ha kéri, engedélyezd a „Telepítés ismeretlen forrásból” lehetőséget a böngészőnek/Fájlkezelőnek → Telepítés. Első indításkor engedélyezd a helymeghatározást.

Ha új verzió jön ki, az app magától szól („Új verzió: v1.0.3 · Letöltés”). Androidon az új APK simán felülírja a régit, a beállítások megmaradnak.

> A frissítés-jelzéshez és ahhoz, hogy bárki letölthesse, a repó legyen **Public**.

### iPhone / iPad

iPhone-ra webappként kerül fel (App Store nélkül):

1. Safariban nyisd meg: **https://balindbence.github.io/uthirnok/**
2. **Megosztás** gomb → **Főképernyőhöz adás** → **Hozzáadás**
3. A kezdőképernyőről indítsd; teljes képernyős appként fut, és új kiadásnál magától frissül.

Egyszeri beállítás ehhez: GitHubon a repó **Settings → Pages → Source: GitHub Actions**. Utána minden `Frissites-feltoltese.bat` futtatáskor a webapp is frissül.

Korlátok iPhone-on: csak úgy navigál, ha az app elöl van és a képernyő be van kapcsolva (az iOS a háttérben nem ad helyet a webappoknak). Igazi App Store-os iOS apphoz Apple fejlesztői fiók kell (évi 99 dollár) és Mac (vagy GitHub Actions macOS gép).

---

## Fejlesztéshez

| Fájl | Mit csinál |
|---|---|
| `Inditas.bat` | elindítja az appot fejlesztői módban (kell hozzá Node.js) |
| `App-keszitese.bat` | saját exe a `dist` mappába + asztali ikon + zip a laptopra |
| `Telepito-keszitese.bat` | telepítő exe helyben (ha symlink-hibát ír: `Telepito-keszitese-ADMIN.bat`) |
| `GitHub-feltoltes.bat` | **egyszeri** beállítás: feltölti GitHubra, és elindítja az első kiadást |
| `Frissites-feltoltese.bat` | utána bármikor: verziószám +1, feltöltés, és a GitHub megépíti az új exe-t és APK-t |

Az androidos APK-t a GitHub Actions építi (Android Studio nem kell a gépedre). Nagyjából 10 perc egy kiadás; az **Actions** fülön látod, hol tart.

Ha csak a webes részen dolgozol, böngészőben is tesztelhetsz:

```
python -m http.server 8080
```

→ http://localhost:8080 (a hely csak localhoston/HTTPS-en működik, ne dupla kattintással nyisd meg). Kipróbálás: keress rá egy helyre → Útvonal ide → **Szimuláció**. A Beállításokban a „Demo jelzések a közelbe” gomb tesztjelzéseket rak le.

---

## Közösségi mód (hogy mások jelzéseit is lásd)

Alapból **helyi módban** fut: a jelzések csak a saját eszközödön vannak. A közösségi módhoz ingyenes Supabase kell:

1. https://supabase.com → regisztráció → **New project** (régió: Frankfurt / Central EU).
2. Bal oldalt **SQL Editor** → New query → másold be a `supabase.sql` teljes tartalmát → **Run**.
3. **Project Settings → API**: másold ki a *Project URL*-t és az *anon public* kulcsot.
4. Írd be őket a `config.js`-be (`SUPABASE_URL`, `SUPABASE_ANON_KEY`), mentsd, és futtasd a `Frissites-feltoltese.bat`-ot — az új exe és APK már közösségi módban fut.

A jobb felső sarokban „● Közösségi mód” jelenik meg. Az anon kulcs nyilvános kulcs, nyugodtan lehet a kódban — a `supabase.sql` jogosultságai miatt mások csak olvasni, beküldeni és szavazni tudnak, törölni/átírni nem.

## Fájlok

| Fájl | Mit csinál |
|---|---|
| `index.html`, `style.css` | felület |
| `config.js` | beállítások, Supabase adatok |
| `js/app.js` | fő logika: térkép, keresés, navigáció, figyelmeztetések, rétegek |
| `js/routing.js` | útvonal (OSRM) + magyar utasítások |
| `js/reports.js` | jelzéstípusok, élettartamok, útvonal-büntetések |
| `js/pois.js` | OSM: fix traffipax, benzinkút, parkoló, sebességkorlát |
| `js/store.js` | adattárolás: Supabase vagy helyi |
| `sw.js`, `manifest.webmanifest` | böngészős (PWA) telepíthetőség, offline térképrészek |
| `supabase.sql` | adatbázis séma |
| `electron/` | a Windows-os ablak |
| `capacitor.config.json`, `scripts/android-setup.js`, `assets/` | az androidos app beállításai és ikonjai |
| `android-key/` | az APK aláírókulcsa — ne töröld, különben a telefonon nem frissíthető az app |
| `scripts/prepare-www.js` | összerakja a `www/` mappát, amiből az exe és az APK készül |
| `.github/workflows/build.yml` | GitHubon építi az exe-t és az APK-t, és kiteszi a Releases oldalra |

## Korlátok, amikről tudni kell

- A sávjelzés csak az OSRM tartalék útvonaltervezővel működik (a Valhalla nem ad sávadatot).
- A Valhalla, OSRM, Nominatim és Overpass ingyenes **nyilvános demószerverek** — tesztre és pár felhasználóra jók, de ha sokan használják, saját szerver (vagy fizetős szolgáltatás) kell. A `config.js`-ben átírhatók.
- Élő forgalmi adat (mint a Google-nél) nincs: a forgalmat a felhasználók jelzései adják — ezért fontos, hogy minél többen használják.
- Háttérben (lezárt képernyővel) nem kap GPS-t — vezetés közben maradjon elöl az app (az androidos app ilyenkor nem engedi elaludni a kijelzőt).
- Asztali gépen általában nincs GPS: ott a térkép a géped hozzávetőleges helyére áll, az indulási pontot kereséssel / jobb klikkel adhatod meg.
