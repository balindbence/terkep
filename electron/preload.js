// Jelzi a webes résznek, hogy asztali appban fut
const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("uthirnokDesktop", { platform: process.platform });
