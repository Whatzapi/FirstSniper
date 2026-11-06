"use strict";
// The only bridge between the control panel page and the app.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getState: () => ipcRenderer.invoke("get-state"),
  setArmed: (on) => ipcRenderer.invoke("set-armed", !!on),
  setOption: (key, on) => ipcRenderer.invoke("set-option", String(key), !!on),
  joinNow: (text) => ipcRenderer.invoke("join-now", String(text || "")),
  setToken: (token, kind) => ipcRenderer.invoke("set-token", String(token || ""), kind === "bot" ? "bot" : "user"),
  clearToken: () => ipcRenderer.invoke("clear-token"),
  loadChannels: (guildId) => ipcRenderer.invoke("load-channels", String(guildId || "")),
  addRule: () => ipcRenderer.invoke("add-rule"),
  setRule: (id, patch) => ipcRenderer.invoke("set-rule", String(id), {
    guildId: patch && typeof patch.guildId === "string" ? patch.guildId : undefined,
    channelId: patch && typeof patch.channelId === "string" ? patch.channelId : undefined,
    keyword: patch && typeof patch.keyword === "string" ? patch.keyword : undefined,
    enabled: patch && typeof patch.enabled === "boolean" ? patch.enabled : undefined,
    always: patch && typeof patch.always === "boolean" ? patch.always : undefined,
    delay: patch && typeof patch.delay === "boolean" ? patch.delay : undefined
  }),
  setTimed: (patch) => ipcRenderer.invoke("set-timed", {
    guildId: patch && typeof patch.guildId === "string" ? patch.guildId : undefined,
    channelId: patch && typeof patch.channelId === "string" ? patch.channelId : undefined,
    keyword: patch && typeof patch.keyword === "string" ? patch.keyword : undefined,
    delay: patch && typeof patch.delay === "boolean" ? patch.delay : undefined,
    waitMs: patch && typeof patch.waitMs === "number" ? patch.waitMs : undefined,
    on: patch && typeof patch.on === "boolean" ? patch.on : undefined
  }),
  removeRule: (id) => ipcRenderer.invoke("remove-rule", String(id)),
  setDelay: (ms) => ipcRenderer.invoke("set-delay", Number(ms) || 0),
  setHotkey: (accel) => ipcRenderer.invoke("set-hotkey", String(accel || "")),
  chooseSound: () => ipcRenderer.invoke("choose-sound"),
  clearSound: () => ipcRenderer.invoke("clear-sound"),
  setSound: (patch) => ipcRenderer.invoke("set-sound", {
    enabled: patch && typeof patch.enabled === "boolean" ? patch.enabled : undefined,
    volume: patch && typeof patch.volume === "number" ? patch.volume : undefined
  }),
  getSoundData: () => ipcRenderer.invoke("get-sound-data"),
  onPlaySound: (cb) => ipcRenderer.on("play-sound", (_event, p) => cb(p || {})),
  onState: (cb) => ipcRenderer.on("state", (_event, s) => cb(s))
});
