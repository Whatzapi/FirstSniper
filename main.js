"use strict";
const { app, BrowserWindow, Menu, Notification, dialog, globalShortcut, ipcMain, safeStorage, shell } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { createCore } = require("./core");
const { createGateway } = require("./gateway");
const { extractRobloxLink, messageText } = require("./links");

const DEFAULT_HOTKEY = "Control+Alt+S";
const HOTKEY_RE = /^(?:(?:Control|Alt|Shift|Super)\+){0,4}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Enter)$/;
const MAX_SOUND_BYTES = 10 * 1024 * 1024;
const SOUND_TYPES = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", webm: "audio/webm" };
const MAX_RULES = 30;
const MAX_KEYWORD = 500;
const ID_RE = /^\d{5,25}$/;
const API = "https://discord.com/api/v10";

let core = null;
let controlWin = null;
let quitting = false;

let kind = "user";                 // "user" = your account token, "bot" = a bot token
let token = "";                    // kept in memory; saved encrypted (never sent to the panel)
let tokenNote = "";                // e.g. "could not be saved"
let rules = [];                    // { id, guildId, channelId, keyword, enabled, always, delay, guildName, channelName }
let timedRule = null;              // the one channel used by Timed mode (same fields, id "timed")
let gw = null;
let hotkey = DEFAULT_HOTKEY;       // the arm/disarm shortcut (an Electron accelerator)
let sound = { enabled: true, volume: 70, file: "", version: 0 };   // file "" = the built-in chime
let gwState = { status: "off", text: "Not connected.", name: "", userId: "" };
let guilds = [];                   // [{ id, name }] for the server picker
let channels = {};                 // guildId -> [{ id, name }]
const recentCreates = new Set();   // ids of messages seen being created (so edits can be told apart)
const handled = new Set();         // ids of messages already joined

// ---- small helpers -------------------------------------------------------
// The only thing this app ever launches. `url` always comes from parse.js, and is
// checked again here so nothing unexpected can ever reach the operating system.
function launch(url) {
  if (!/^roblox:\/\/[A-Za-z0-9_.\-\/?=&]+$/.test(String(url))) {
    return Promise.reject(new Error("blocked an unexpected link"));
  }
  return shell.openExternal(url);
}

function remember(set, id, cap) {
  set.add(id);
  if (set.size > cap) set.delete(set.values().next().value);
}

function cleanToken(raw) {
  let t = String(raw || "").trim().replace(/^["']|["']$/g, "").replace(/^Bot\s+/i, "").trim();
  return /^[A-Za-z0-9._\-]{20,200}$/.test(t) ? t : "";
}

// ---- settings -----------------------------------------------------------
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

// The app used to be called "Roblox Auto-Join". Carry its saved settings over once.
function migrateOldSettings() {
  try {
    if (fs.existsSync(settingsPath())) return;
    const old = path.join(app.getPath("appData"), "Roblox Auto-Join", "settings.json");
    if (fs.existsSync(old)) fs.copyFileSync(old, settingsPath());
  } catch (e) { /* starting fresh is fine */ }
}

function loadSettings() {
  try {
    const j = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return j && typeof j === "object" ? j : {};
  } catch (e) { return {}; }
}

function cleanRule(r) {
  if (!r || typeof r !== "object") return null;
  return {
    id: typeof r.id === "string" && r.id ? r.id.slice(0, 64) : crypto.randomUUID(),
    guildId: ID_RE.test(String(r.guildId || "")) ? String(r.guildId) : "",
    channelId: ID_RE.test(String(r.channelId || "")) ? String(r.channelId) : "",
    keyword: typeof r.keyword === "string" ? r.keyword.slice(0, MAX_KEYWORD) : "",
    enabled: r.enabled !== false,
    always: r.always === true,              // joins even when the app is not armed
    delay: r.delay !== false,               // whether the join delay applies to this channel
    guildName: typeof r.guildName === "string" ? r.guildName.slice(0, 100) : "",
    channelName: typeof r.channelName === "string" ? r.channelName.slice(0, 100) : ""
  };
}

function saveSettings() {
  if (!core) return;
  const s = core.getState();
  const out = {
    oneShot: s.oneShot, onTop: s.onTop, alert: s.alert, delayMs: s.delayMs,
    tokenKind: kind, rules, timed: timedRule, timedWaitMs: s.timed.waitMs, hotkey,
    sound: { enabled: sound.enabled, volume: sound.volume, file: sound.file }
  };
  tokenNote = "";
  if (token) {
    try {
      if (safeStorage.isEncryptionAvailable()) out.tokenEnc = safeStorage.encryptString(token).toString("base64");
      else tokenNote = "Windows could not encrypt the token, so it is not saved. You will need to paste it each time.";
    } catch (e) { tokenNote = "The token could not be saved. You will need to paste it each time."; }
  }
  try { fs.writeFileSync(settingsPath(), JSON.stringify(out, null, 2)); } catch (e) { /* a convenience, never fatal */ }
}

function loadToken(saved) {
  if (typeof saved.tokenEnc !== "string" || !saved.tokenEnc) return "";
  try {
    if (!safeStorage.isEncryptionAvailable()) return "";
    return cleanToken(safeStorage.decryptString(Buffer.from(saved.tokenEnc, "base64")));
  } catch (e) { return ""; }
}

// ---- state for the panel ------------------------------------------------------
function hotkeyLabel(a) { return String(a).replace(/Control/g, "Ctrl").replace(/Super/g, "Win"); }

function inviteUrl() {
  // Only for a bot: where to add it to a server (View Channels + Read Message History).
  return kind === "bot" && gwState.userId
    ? "https://discord.com/oauth2/authorize?client_id=" + gwState.userId + "&scope=bot&permissions=66560"
    : "";
}

function fullState() {
  return Object.assign({}, core.getState(), {
    version: typeof app.getVersion === "function" ? app.getVersion() : "",
    hotkey: hotkeyLabel(hotkey),
    sound: { enabled: sound.enabled, volume: sound.volume, custom: !!sound.file, fileName: sound.file ? path.basename(sound.file) : "", version: sound.version },
    timed: Object.assign({}, core.getState().timed, {
      guildId: timedRule.guildId, channelId: timedRule.channelId, keyword: timedRule.keyword, delay: timedRule.delay,
      guildName: timedRule.guildName, channelName: timedRule.channelName
    }),
    rules,
    guilds,
    channels,
    gateway: {
      status: gwState.status, text: gwState.text, name: gwState.name,
      hasToken: !!token, kind, note: tokenNote, invite: inviteUrl()
    }
  });
}

function broadcast() {
  if (core && controlWin && !controlWin.isDestroyed()) controlWin.webContents.send("state", fullState());
}

function onCoreChange(s) {
  if (controlWin && !controlWin.isDestroyed()) controlWin.setAlwaysOnTop(!!s.onTop);
  broadcast();
  if (!quitting) saveSettings();
}

function changed() { broadcast(); if (!quitting) saveSettings(); syncSubscriptions(); }

// ---- the alert after a join ------------------------------------------------------
// The notification is silent on purpose: the sound is your own choice (or the built-in
// chime), played by the control panel at the volume you set. No Windows sound is used.
function onJoin(info) {
  const s = core.getState();
  if (s.alert) {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: "Joining a Roblox server", body: String(info.label || "Discord"), silent: true }).show();
      }
    } catch (e) { /* notifications are optional */ }
    try { if (controlWin && !controlWin.isDestroyed()) controlWin.flashFrame(true); } catch (e) { /* optional */ }
  }
  if (sound.enabled && controlWin && !controlWin.isDestroyed()) {
    try { controlWin.webContents.send("play-sound", { volume: sound.volume }); } catch (e) { /* optional */ }
  }
}

// ---- talking to Discord -------------------------------------------------------------
function labelFor(rule) {
  if (rule.channelName) return "Discord #" + rule.channelName + (rule.guildName ? " (" + rule.guildName + ")" : "");
  return "Discord channel " + rule.channelId;
}

async function discordGet(p) {
  const res = await fetch(API + p, {
    headers: {
      Authorization: kind === "bot" ? "Bot " + token : token,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    },
    signal: AbortSignal.timeout(10000)
  });
  if (res.status === 401) throw new Error("Discord rejected the token");
  if (res.status === 429) throw new Error("Discord says slow down; try again in a moment");
  if (!res.ok) throw new Error("Discord answered " + res.status);
  return res.json();
}

async function loadGuilds() {
  if (!token) return;
  try {
    const list = await discordGet("/users/@me/guilds");
    guilds = (Array.isArray(list) ? list : [])
      .filter((g) => g && ID_RE.test(String(g.id)))
      .map((g) => ({ id: String(g.id), name: String(g.name || g.id).slice(0, 100) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    fillAllNames();
    changed();
  } catch (e) {
    core.note("Could not load your servers: " + e.message + ". You can still use saved channels.");
  }
}

async function loadChannels(guildId) {
  if (!token || !ID_RE.test(String(guildId))) return;
  try {
    const list = await discordGet("/guilds/" + guildId + "/channels");
    channels[guildId] = (Array.isArray(list) ? list : [])
      .filter((c) => c && (c.type === 0 || c.type === 5) && ID_RE.test(String(c.id)))
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((c) => ({ id: String(c.id), name: String(c.name || c.id).slice(0, 100) }));
    fillAllNames();
    changed();
  } catch (e) {
    core.note("Could not load that server's channels: " + e.message + ".");
  }
}

function fillNames(rule) {
  const g = guilds.find((x) => x.id === rule.guildId);
  if (g) rule.guildName = g.name;
  const c = (channels[rule.guildId] || []).find((x) => x.id === rule.channelId);
  if (c) rule.channelName = c.name;
}

function fillAllNames() {
  rules.forEach(fillNames);
  if (timedRule) fillNames(timedRule);
}

function syncSubscriptions() {
  if (!gw) return;
  const list = rules.filter((r) => r.enabled && r.guildId && r.channelId);
  if (timedRule && timedRule.guildId && timedRule.channelId) list.push(timedRule);
  gw.subscribe(list);
}

function stopGateway() {
  if (gw) { gw.stop(); gw = null; }
}

function startGateway() {
  stopGateway();
  if (!token) { gwState = { status: "off", text: "Not connected.", name: "", userId: "" }; broadcast(); return; }
  gw = createGateway({
    WebSocket, token, mode: kind,
    onStatus: (status, text) => { gwState = Object.assign({}, gwState, { status, text }); broadcast(); },
    onReady: (u) => {
      gwState = Object.assign({}, gwState, {
        name: u ? String(u.global_name || u.username || "") : "", userId: u && ID_RE.test(String(u.id)) ? String(u.id) : ""
      });
      broadcast();
    },
    onMessage: onGatewayMessage
  });
  gw.start();
  syncSubscriptions();
}

// A new message arrived in some channel we can see.
function onGatewayMessage(msg, type, me) {
  if (!msg || typeof msg.id !== "string" || typeof msg.channel_id !== "string") return;
  if (type === "MESSAGE_CREATE") remember(recentCreates, msg.id, 500);
  // An edit only counts for a message we saw being posted, and only when it carries text.
  else if (typeof msg.content !== "string" || !recentCreates.has(msg.id)) return;
  if (me && msg.author && msg.author.id === me.id) return;               // never react to yourself

  const s = core.getState();
  // Which channel settings apply to this message:
  //  - a channel with "Always join" on, whether or not the app is armed;
  //  - the other channels, only while the ARMED button is on (and Timed mode is off);
  //  - the Timed channel, only while Timed mode is on and armed.
  const cands = [];
  rules.forEach((r) => {
    if (!r.enabled || r.channelId !== msg.channel_id) return;
    if (r.always) cands.push({ rule: r, always: true });
    else if (s.armed && !s.timed.on) cands.push({ rule: r });
  });
  if (s.timed.on && s.timed.armed && timedRule.channelId && timedRule.channelId === msg.channel_id) cands.push({ rule: timedRule, timed: true });
  if (!cands.length || handled.has(msg.id)) return;

  const link = extractRobloxLink(msg);
  if (!link) return;
  const text = messageText(msg);

  let skipped = null;
  for (const c of cands) {
    const res = core.fromDiscord(link.raw, {
      text, keyword: c.rule.keyword, label: labelFor(c.rule),
      always: !!c.always, timed: !!c.timed, applyDelay: c.rule.delay
    });
    if (res.ok) { remember(handled, msg.id, 500); return; }
    if (res.reason === "keyword") { skipped = c; continue; }
    return;                                                              // off / duplicate
  }
  if (skipped) {
    core.note("Skipped a link in " + labelFor(skipped.rule) + ': the message did not contain "' + skipped.rule.keyword.trim() + '". Still ' + (skipped.always ? "on" : "armed") + ".");
  }
}

// ---- windows ---------------------------------------------------------------
// The window has one fixed size: it cannot be resized, maximized or zoomed, so the layout
// never breaks. Long content scrolls inside the window.
const WINDOW_W = 480, WINDOW_H = 760;

function createControl() {
  controlWin = new BrowserWindow({
    width: WINDOW_W, height: WINDOW_H, useContentSize: true,
    minWidth: WINDOW_W, maxWidth: WINDOW_W, minHeight: WINDOW_H, maxHeight: WINDOW_H,
    resizable: false, maximizable: false, fullscreenable: false,
    title: "FirstSniper",
    autoHideMenuBar: true, backgroundColor: "#17181c",
    alwaysOnTop: !!core.getState().onTop,
    webPreferences: {
      preload: path.join(__dirname, "control-preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      zoomFactor: 1,
      backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required"   // the alert sound must play even when minimized
    }
  });
  try {
    controlWin.webContents.setZoomFactor(1);
    controlWin.webContents.setVisualZoomLevelLimits(1, 1);
  } catch (e) { /* zoom lock is a nicety */ }
  controlWin.webContents.on("will-navigate", (e) => e.preventDefault());
  controlWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  controlWin.on("focus", () => { try { controlWin.flashFrame(false); } catch (e) { /* optional */ } });
  controlWin.loadFile(path.join(__dirname, "index.html"));
  controlWin.on("closed", () => { controlWin = null; app.quit(); });
}

// Registers the new shortcut first and only lets go of the old one if that worked.
function setHotkey(accel) {
  const parts = accel.split("+");
  const mods = parts.slice(0, -1);
  const ok = HOTKEY_RE.test(accel) && new Set(mods).size === mods.length && (mods.length > 0 || /^F\d/.test(accel));
  if (!ok) { core.note("That shortcut is not allowed. Use a modifier (Ctrl, Alt, Shift) plus a key."); return { ok: false }; }
  if (accel === hotkey) return { ok: true };
  let registered = false;
  try { registered = globalShortcut.register(accel, toggleArmed); } catch (e) { registered = false; }
  if (!registered) { core.note(hotkeyLabel(accel) + " is used by another program. The shortcut is still " + hotkeyLabel(hotkey) + "."); return { ok: false }; }
  try { globalShortcut.unregister(hotkey); } catch (e) { /* the old one may already be gone */ }
  hotkey = accel;
  changed();
  core.note("Shortcut is now " + hotkeyLabel(hotkey) + ".");
  return { ok: true };
}
function toggleArmed() { core.setArmed(!core.getState().armed); }

// ---- messages from the panel ---------------------------------------------------
function registerIpc() {
  const fromControl = (e) => !!controlWin && e.sender === controlWin.webContents;

  ipcMain.handle("get-state", (e) => (fromControl(e) ? fullState() : null));
  ipcMain.handle("set-armed", (e, on) => { if (fromControl(e)) core.setArmed(!!on); });
  ipcMain.handle("set-option", (e, key, on) => { if (fromControl(e)) core.setOption(String(key), !!on); });
  ipcMain.handle("join-now", (e, text) => {
    if (!fromControl(e)) return { ok: false };
    return core.joinNow(String(text || "").slice(0, 2000));
  });

  // How long to wait between a match and opening Roblox (0 - 10 seconds).
  ipcMain.handle("set-delay", (e, ms) => { if (fromControl(e)) core.setDelay(Number(ms)); });

  // The shortcut that arms / disarms the app from anywhere.
  ipcMain.handle("set-hotkey", (e, accel) => {
    if (!fromControl(e)) return { ok: false };
    return setHotkey(String(accel || ""));
  });

  // The alert sound: your own file or the built-in chime, and its volume.
  ipcMain.handle("choose-sound", async (e) => {
    if (!fromControl(e)) return { ok: false };
    const r = await dialog.showOpenDialog(controlWin, {
      title: "Choose an alert sound", properties: ["openFile"],
      filters: [{ name: "Audio", extensions: Object.keys(SOUND_TYPES) }]
    });
    if (!r || r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false };
    const f = r.filePaths[0];
    const ext = path.extname(f).slice(1).toLowerCase();
    try {
      if (!SOUND_TYPES[ext]) throw new Error("that is not a sound file type I can play");
      if (fs.statSync(f).size > MAX_SOUND_BYTES) throw new Error("that file is bigger than 10 MB");
    } catch (err) { core.note("Could not use that sound: " + err.message + "."); return { ok: false }; }
    sound.file = f; sound.version++;
    changed();
    return { ok: true };
  });
  ipcMain.handle("clear-sound", (e) => {
    if (!fromControl(e)) return;
    sound.file = ""; sound.version++;
    changed();
  });
  ipcMain.handle("set-sound", (e, patch) => {
    if (!fromControl(e) || !patch || typeof patch !== "object") return;
    if (typeof patch.enabled === "boolean") sound.enabled = patch.enabled;
    if (Number.isFinite(patch.volume)) sound.volume = Math.max(0, Math.min(100, Math.round(patch.volume)));
    changed();
  });
  // The panel plays the sound itself, so it asks for the chosen file's bytes.
  ipcMain.handle("get-sound-data", (e) => {
    if (!fromControl(e) || !sound.file) return null;
    try {
      const ext = path.extname(sound.file).slice(1).toLowerCase();
      if (!SOUND_TYPES[ext]) return null;
      return { mime: SOUND_TYPES[ext], base64: fs.readFileSync(sound.file).toString("base64") };
    } catch (err) {
      core.note("Could not read your alert sound (" + err.message + "). The built-in chime is used instead.");
      return null;
    }
  });

  // The Discord connection.
  ipcMain.handle("set-token", async (e, raw, tokenKind) => {
    if (!fromControl(e)) return { ok: false };
    const t = cleanToken(raw);
    if (!t) { core.note("That does not look like a Discord token. Paste the whole token."); return { ok: false }; }
    token = t;
    kind = tokenKind === "bot" ? "bot" : "user";
    guilds = []; channels = {};
    saveSettings();
    startGateway();
    broadcast();
    await loadGuilds();
    return { ok: true };
  });
  ipcMain.handle("clear-token", (e) => {
    if (!fromControl(e)) return;
    token = ""; guilds = []; channels = {};
    stopGateway();
    gwState = { status: "off", text: "Not connected.", name: "", userId: "" };
    saveSettings();
    broadcast();
  });
  ipcMain.handle("load-channels", (e, guildId) => (fromControl(e) ? loadChannels(String(guildId)) : undefined));

  // Channel rules: which channel, which keywords.
  ipcMain.handle("add-rule", (e) => {
    if (!fromControl(e)) return;
    if (rules.length >= MAX_RULES) { core.note("You can have at most " + MAX_RULES + " channels."); return; }
    rules.push(cleanRule({ enabled: true }));
    changed();
  });
  // Edits one channel's settings (shared by the Channels tab and the Timed tab).
  function applyChannelPatch(r, patch) {
    if (typeof patch.keyword === "string") r.keyword = patch.keyword.slice(0, MAX_KEYWORD);
    if (typeof patch.delay === "boolean") r.delay = patch.delay;
    if (typeof patch.guildId === "string" && (patch.guildId === "" || ID_RE.test(patch.guildId))) {
      if (patch.guildId !== r.guildId) { r.channelId = ""; r.channelName = ""; }
      r.guildId = patch.guildId;
      r.guildName = "";
    }
    if (typeof patch.channelId === "string" && (patch.channelId === "" || ID_RE.test(patch.channelId))) {
      r.channelId = patch.channelId;
      r.channelName = "";
    }
    fillNames(r);
  }

  ipcMain.handle("set-rule", (e, id, patch) => {
    if (!fromControl(e) || !patch || typeof patch !== "object") return;
    const r = rules.find((x) => x.id === id);
    if (!r) return;
    if (typeof patch.enabled === "boolean") r.enabled = patch.enabled;
    if (typeof patch.always === "boolean") r.always = patch.always;
    applyChannelPatch(r, patch);
    changed();
  });

  // Timed mode: its one channel, the wait before it arms again, and its on/off switch.
  ipcMain.handle("set-timed", (e, patch) => {
    if (!fromControl(e) || !patch || typeof patch !== "object") return;
    applyChannelPatch(timedRule, patch);
    const p = {};
    if (Number.isFinite(patch.waitMs)) p.waitMs = patch.waitMs;
    if (typeof patch.on === "boolean") {
      if (patch.on && !(timedRule.guildId && timedRule.channelId)) {
        core.note("Pick a server and a channel for Timed mode first.");
        changed();
        return;
      }
      p.on = patch.on;
    }
    core.setTimed(p);
    changed();
  });
  ipcMain.handle("remove-rule", (e, id) => {
    if (!fromControl(e)) return;
    rules = rules.filter((x) => x.id !== id);
    changed();
  });
}

// ---- start up ----------------------------------------------------------------
async function start() {
  await app.whenReady();
  migrateOldSettings();
  const saved = loadSettings();
  core = createCore({ launch, initial: saved, onChange: onCoreChange, onJoin });
  kind = saved.tokenKind === "bot" ? "bot" : "user";
  rules = (Array.isArray(saved.rules) ? saved.rules : []).map(cleanRule).filter(Boolean).slice(0, MAX_RULES);
  timedRule = cleanRule(Object.assign({}, saved.timed && typeof saved.timed === "object" ? saved.timed : {}, { id: "timed", enabled: true }));
  token = loadToken(saved);
  if (typeof saved.hotkey === "string" && HOTKEY_RE.test(saved.hotkey)) hotkey = saved.hotkey;
  if (saved.sound && typeof saved.sound === "object") {
    if (typeof saved.sound.enabled === "boolean") sound.enabled = saved.sound.enabled;
    if (Number.isFinite(saved.sound.volume)) sound.volume = Math.max(0, Math.min(100, Math.round(saved.sound.volume)));
    if (typeof saved.sound.file === "string") sound.file = saved.sound.file;
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "editMenu" }]));

  registerIpc();
  createControl();

  if (token) {
    startGateway();
    loadGuilds().then(() => Promise.all([...new Set(rules.concat(timedRule).map((r) => r.guildId).filter(Boolean))].map(loadChannels)));
  }

  let ok = false;
  try { ok = globalShortcut.register(hotkey, toggleArmed); } catch (e) { ok = false; }
  if (!ok) core.note("The shortcut " + hotkeyLabel(hotkey) + " is used by another program. Pick another one below, or use the big button.");
}

app.on("second-instance", () => {
  if (controlWin && !controlWin.isDestroyed()) {
    if (controlWin.isMinimized()) controlWin.restore();
    controlWin.focus();
  }
});
app.on("before-quit", () => { if (!quitting) { saveSettings(); quitting = true; stopGateway(); } });
app.on("will-quit", () => globalShortcut.unregisterAll());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start().catch((err) => { console.error(err); app.quit(); });
}
