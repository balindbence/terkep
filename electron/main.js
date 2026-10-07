// Úthírnök — asztali (Windows) ablak
"use strict";
const { app, BrowserWindow, shell, session, Menu } = require("electron");
const path = require("path");

if (!app.requestSingleInstanceLock()) app.quit();

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 600,
    title: "Úthírnök", backgroundColor: "#0f1724", show: false,
    icon: path.join(__dirname, "..", "www", "icons", "icon-512.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => win.show());

  // külső linkek (térkép-forrás, frissítés letöltése) a rendes böngészőben nyíljanak
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) { e.preventDefault(); shell.openExternal(url); }
  });
  // F12: fejlesztői eszközök, F5: újratöltés
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") win.webContents.toggleDevTools();
    if (input.key === "F5") win.webContents.reload();
  });

  win.loadFile(path.join(__dirname, "..", "www", "index.html"));
}

app.whenReady().then(() => {
  // hely és képernyő ébren tartás engedélyezése
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(["geolocation", "wake-lock", "notifications"].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ["geolocation", "wake-lock", "notifications"].includes(perm));
  createWindow();
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
