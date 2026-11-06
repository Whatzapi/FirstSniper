(() => {
  const $ = (id) => document.getElementById(id);
  const OPTIONS = ["oneShot", "alert", "onTop"];
  const DEFAULT_HOTKEY = "Control+Alt+S";
  const MAX_SHOWN = 100;
  const rows = new Map();   // rule id -> its row in the panel
  let cur = null;

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ---------------------------------------------------------------- searchable picker
  // A text box with a drop-down under it. Click it, type to filter, click (or press
  // Enter on) a choice. Used for the server and the channel.
  function makePicker(placeholder, onPick) {
    const wrap = el("div", "picker");
    const input = el("input", "pickInput");
    input.type = "text";
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.autocomplete = "off";
    const menu = el("div", "pickMenu closed");
    wrap.append(input, menu);

    let items = [];       // [{ id, name }]
    let value = "";
    let typed = false;    // true once you type: before that the whole list is shown
    let open = false;
    let hi = 0;           // highlighted entry (for the keyboard)

    const labelOf = () => { const it = items.find((i) => i.id === value); return it ? it.name : ""; };
    const matches = () => {
      const q = typed ? input.value.trim().toLowerCase() : "";
      return items.filter((i) => !q || i.name.toLowerCase().includes(q));
    };

    function draw() {
      menu.textContent = "";
      menu.className = open ? "pickMenu" : "pickMenu closed";
      if (!open) return;
      const list = matches();
      if (hi >= list.length) hi = Math.max(0, list.length - 1);
      if (!list.length) {
        const none = el("div", "none");
        none.textContent = items.length ? "No match" : "Nothing to show yet";
        menu.appendChild(none);
        return;
      }
      list.slice(0, MAX_SHOWN).forEach((it, i) => {
        const o = el("div", "opt" + (it.id === value ? " sel" : "") + (i === hi ? " hi" : ""));
        o.textContent = it.name;
        o.addEventListener("mousedown", (e) => { if (e.preventDefault) e.preventDefault(); choose(it.id); });
        menu.appendChild(o);
      });
      if (list.length > MAX_SHOWN) {
        const more = el("div", "none");
        more.textContent = (list.length - MAX_SHOWN) + " more - keep typing to narrow it down";
        menu.appendChild(more);
      }
    }

    function close() {
      open = false; typed = false;
      input.value = labelOf();
      draw();
    }

    function choose(id) {
      value = id;
      close();
      if (input.blur) input.blur();
      onPick(id);
    }

    input.addEventListener("focus", () => {
      open = true; typed = false; hi = 0;
      if (input.select) input.select();
      draw();
    });
    input.addEventListener("input", () => { typed = true; open = true; hi = 0; draw(); });
    input.addEventListener("blur", close);
    input.addEventListener("keydown", (e) => {
      const list = matches().slice(0, MAX_SHOWN);
      if (e.key === "ArrowDown") { hi = Math.min(list.length - 1, hi + 1); open = true; draw(); if (e.preventDefault) e.preventDefault(); }
      else if (e.key === "ArrowUp") { hi = Math.max(0, hi - 1); draw(); if (e.preventDefault) e.preventDefault(); }
      else if (e.key === "Enter") { if (list[hi]) choose(list[hi].id); if (e.preventDefault) e.preventDefault(); }
      else if (e.key === "Escape") { close(); if (input.blur) input.blur(); }
    });

    return {
      wrap, input, menu,
      setItems(list) { items = list; if (open) draw(); else input.value = labelOf(); },
      setValue(v) { value = v; if (!open) input.value = labelOf(); }
    };
  }

  // ---------------------------------------------------------------- keyword tags
  const MAX_KEYWORD = 500;
  const splitKeywords = (s) => String(s || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const chipKind = (k) => (k[0] === "+" ? "must" : k[0] === "-" ? "not" : "any");

  // The keywords of a channel are shown as tags you can remove. They are stored as one
  // comma-separated text, so the saved format does not change.
  function drawChips(r) {
    r.chipEls.forEach((c) => c.remove());
    r.chipEls = [];
    r.chips.forEach((k, i) => {
      const kind = chipKind(k);
      const chip = el("span", "chip " + kind);
      const text = el("span", "chipText");
      text.textContent = kind === "must" ? "+ " + k.slice(1).trim() : kind === "not" ? "- " + k.slice(1).trim() : k;
      text.title = k;
      const x = el("button", "chipX");
      x.textContent = "x";
      x.title = "Remove";
      x.addEventListener("click", (e) => {
        if (e.stopPropagation) e.stopPropagation();
        r.chips = r.chips.filter((_, j) => j !== i);
        saveChips(r);
      });
      chip.append(text, x);
      r.kwBox.insertBefore(chip, r.kwInput);
      r.chipEls.push(chip);
    });
    r.kwInput.placeholder = r.chips.length ? "Add another..." : "Type a keyword, press Enter (empty = any link)";
  }

  function saveChips(r) {
    drawChips(r);
    r.update({ keyword: r.chips.join(", ") });
  }

  // Turns whatever is typed into tags (several at once if there are commas).
  function commitTyped(r) {
    const tokens = splitKeywords(r.kwInput.value);
    r.kwInput.value = "";
    let added = false;
    tokens.forEach((tok) => {
      if (r.chips.some((c) => c.toLowerCase() === tok.toLowerCase())) return;
      if (r.chips.concat(tok).join(", ").length > MAX_KEYWORD) return;
      r.chips.push(tok);
      added = true;
    });
    if (added) saveChips(r);
  }

  // ---------------------------------------------------------------- one channel's settings
  function checkbox(text, onChange) {
    const label = el("label", "check");
    const input = el("input");
    input.type = "checkbox";
    label.append(input, document.createTextNode(" " + text));
    input.addEventListener("change", () => onChange(input.checked));
    return { label, input };
  }

  // The settings of one channel: server, channel, keywords and switches. Used by every row
  // of the Channels tab (cfg.timed false) and by the Timed tab (cfg.timed true).
  //   cfg.parent: where it goes   cfg.update(patch): saves a change
  //   cfg.remove(): the Remove button (Channels tab only)
  function makeChannelBox(cfg) {
    const box = el("div", cfg.timed ? "rule timedBox" : "rule");
    const r = { box, timed: !!cfg.timed, update: cfg.update, chips: [], chipEls: [] };

    if (!cfg.timed) {
      const top = el("div", "ruleTop");
      const watch = checkbox("Watch this channel", (v) => cfg.update({ enabled: v }));
      const remove = el("button", "btn small danger");
      remove.textContent = "Remove";
      remove.addEventListener("click", cfg.remove);
      top.append(watch.label, remove);
      box.appendChild(top);
      r.enabled = watch.input;
    }

    r.server = makePicker("Search servers...", (gid) => {
      cfg.update({ guildId: gid });
      if (gid) window.api.loadChannels(gid);
    });
    r.channel = makePicker("Search channels...", (cid) => cfg.update({ channelId: cid }));

    r.kwBox = el("div", "kwBox");
    r.kwInput = el("input", "kwInput");
    r.kwInput.type = "text";
    r.kwInput.spellcheck = false;
    r.kwInput.autocomplete = "off";
    r.kwBox.appendChild(r.kwInput);
    r.kwBox.addEventListener("click", () => r.kwInput.focus());
    r.kwInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") { if (e.preventDefault) e.preventDefault(); commitTyped(r); }
      else if (e.key === "Backspace" && !r.kwInput.value && r.chips.length) { r.chips = r.chips.slice(0, -1); saveChips(r); }
    });
    r.kwInput.addEventListener("input", () => { if (/[,\n]/.test(r.kwInput.value)) commitTyped(r); });   // paste with commas
    r.kwInput.addEventListener("blur", () => commitTyped(r));

    const opts = el("div", "ruleOpts");
    if (!cfg.timed) {
      const always = checkbox("Always join (even when unarmed)", (v) => cfg.update({ always: v }));
      r.always = always.input;
      opts.appendChild(always.label);
    }
    const delay = checkbox("Apply delay", (v) => cfg.update({ delay: v }));
    r.delay = delay.input;
    opts.appendChild(delay.label);

    box.append(r.server.wrap, r.channel.wrap, r.kwBox, opts);
    cfg.parent.appendChild(box);
    drawChips(r);
    return r;
  }

  // Shows a channel's saved settings (data) in its box.
  function applyChannel(r, data, s) {
    if (!r.timed) r.box.className = data.enabled ? "rule" : "rule off";

    const servers = (s.guilds || []).map((g) => ({ id: g.id, name: g.name }));
    if (data.guildId && !servers.some((g) => g.id === data.guildId)) {
      servers.push({ id: data.guildId, name: data.guildName || "Server " + data.guildId });
    }
    r.server.setItems(servers);
    r.server.setValue(data.guildId || "");

    const chans = ((s.channels && s.channels[data.guildId]) || []).map((c) => ({ id: c.id, name: "#" + c.name }));
    if (data.channelId && !chans.some((c) => c.id === data.channelId)) {
      chans.push({ id: data.channelId, name: data.channelName ? "#" + data.channelName : "Channel " + data.channelId });
    }
    r.channel.setItems(chans);
    r.channel.setValue(data.channelId || "");
    r.channel.input.disabled = !data.guildId;
    r.channel.input.placeholder = data.guildId ? "Search channels..." : "Pick a server first";

    // Never overwrite a box you are touching.
    if (r.enabled && document.activeElement !== r.enabled) r.enabled.checked = !!data.enabled;
    if (r.always && document.activeElement !== r.always) r.always.checked = !!data.always;
    if (document.activeElement !== r.delay) r.delay.checked = data.delay !== false;
    const fromState = splitKeywords(data.keyword);
    if (JSON.stringify(fromState) !== JSON.stringify(r.chips)) { r.chips = fromState; drawChips(r); }
  }

  function renderRules(s) {
    const list = s.rules || [];
    const ids = new Set(list.map((r) => r.id));
    rows.forEach((r, id) => { if (!ids.has(id)) { r.box.remove(); rows.delete(id); } });
    $("noRules").className = list.length ? "empty hide" : "empty";

    list.forEach((rule) => {
      let r = rows.get(rule.id);
      if (!r) {
        r = makeChannelBox({
          parent: $("rules"),
          update: (patch) => window.api.setRule(rule.id, patch),
          remove: () => window.api.removeRule(rule.id)
        });
        rows.set(rule.id, r);
      }
      applyChannel(r, rule, s);
    });
  }

  // ---------------------------------------------------------------- timed mode
  const timedBox = makeChannelBox({ parent: $("timedChannel"), timed: true, update: (patch) => window.api.setTimed(patch) });

  const UNITS = [[3600, "3600"], [60, "60"], [1, "1"]];
  function waitFromMs(ms) {
    const sec = Math.max(1, Math.round(ms / 1000));
    for (const [secs, val] of UNITS) if (sec % secs === 0 && sec / secs <= 999) return { value: sec / secs, unit: val };
    return { value: Math.min(999, sec), unit: "1" };
  }
  function waitToMs() {
    const v = Math.max(1, Math.min(999, Math.floor(Number($("timedWait").value) || 1)));
    return Math.max(1000, Math.min(86400000, v * Number($("timedUnit").value) * 1000));
  }
  const clock = (sec) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = (h ? String(m).padStart(2, "0") : String(m));
    return (h ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
  };

  // The line under the Timed switch: off / armed / counting down. Runs 4 times a second.
  function updateTimedStatus() {
    const tm = cur && cur.timed;
    const box = $("timedStatus");
    if (!tm || !tm.on) { box.textContent = "Off. Pick a channel, then turn Timed mode on."; box.className = "timedStatus"; return; }
    const where = tm.channelName ? "#" + tm.channelName : "the channel";
    if (tm.armed) { box.textContent = "ARMED - waiting for a message in " + where + "."; box.className = "timedStatus armed"; }
    else if (tm.nextAt) {
      const left = Math.max(0, Math.ceil((tm.nextAt - Date.now()) / 1000));
      box.textContent = "Joined. Arms again in " + clock(left) + ".";
      box.className = "timedStatus wait";
    } else { box.textContent = "Joining..."; box.className = "timedStatus wait"; }
  }
  setInterval(updateTimedStatus, 250);

  function renderTimed(s) {
    const tm = s.timed || { on: false, armed: false, waitMs: 60000, nextAt: 0 };
    $("timedToggle").textContent = tm.on ? "TIMED MODE ON - click to turn off" : "TIMED MODE OFF - click to turn on";
    $("timedToggle").className = "bigBtn" + (tm.on ? " on" : "");
    applyChannel(timedBox, tm, s);
    if (document.activeElement !== $("timedWait") && document.activeElement !== $("timedUnit")) {
      const w = waitFromMs(tm.waitMs || 60000);
      $("timedWait").value = String(w.value);
      $("timedUnit").value = w.unit;
    }
    updateTimedStatus();
  }

  // ---------------------------------------------------------------- sound
  let audioEl = null;
  let soundVersion = -1;
  let soundReady = Promise.resolve();
  let audioCtx = null;

  function loadSound(s) {
    if (!s || !s.sound || s.sound.version === soundVersion) return;
    soundVersion = s.sound.version;
    audioEl = null;
    if (!s.sound.custom) return;
    soundReady = window.api.getSoundData().then((d) => {
      if (d && d.base64) { audioEl = new Audio("data:" + d.mime + ";base64," + d.base64); audioEl.preload = "auto"; }
    }).catch(() => {});
  }

  // The built-in chime: two soft notes, made here, no file and no Windows sound.
  function chime(vol) {
    try {
      audioCtx = audioCtx || new AudioContext();
      const t0 = audioCtx.currentTime;
      [880, 1318.5].forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        const st = t0 + i * 0.16;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * 0.6), st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.32);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(st); o.stop(st + 0.34);
      });
    } catch (e) { /* no audio device */ }
  }

  function play(percent) {
    const v = Math.max(0, Math.min(1, Number(percent) / 100));
    if (!(v > 0)) return;
    if (audioEl) {
      audioEl.currentTime = 0;
      audioEl.volume = v;
      const p = audioEl.play();
      if (p && p.catch) p.catch(() => chime(v));
    } else {
      chime(v);
    }
  }

  function renderSound(s) {
    const so = s.sound || { enabled: true, volume: 70, custom: false, fileName: "", version: 0 };
    loadSound(s);
    if (document.activeElement !== $("soundEnabled")) $("soundEnabled").checked = !!so.enabled;
    $("soundName").textContent = so.custom ? so.fileName : "Built-in chime";
    if (document.activeElement !== $("volume")) {
      $("volume").value = String(so.volume);
      $("volumeVal").textContent = so.volume + "%";
    }
  }

  // ---------------------------------------------------------------- hotkey
  let listening = false;

  function stopListening() {
    listening = false;
    $("hotkeyBtn").className = "btn key";
    if (cur) $("hotkeyBtn").textContent = cur.hotkey || "Ctrl+Alt+S";
  }

  // Turns a key press into an Electron shortcut, or null while it is only a modifier.
  function accelFrom(e) {
    const code = String(e.code || "");
    let key = null, m;
    if ((m = /^Key([A-Z])$/.exec(code))) key = m[1];
    else if ((m = /^Digit(\d)$/.exec(code))) key = m[1];
    else if (/^F\d{1,2}$/.test(code)) key = code;
    else if (code === "Space") key = "Space";
    else if (code === "Tab") key = "Tab";
    else if (/^Arrow(Up|Down|Left|Right)$/.test(code)) key = code.slice(5);
    else if (["Home", "End", "PageUp", "PageDown", "Insert", "Delete", "Backspace", "Enter"].includes(code)) key = code;
    if (!key) return null;
    const mods = [];
    if (e.ctrlKey) mods.push("Control");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.metaKey) mods.push("Super");
    if (!mods.length && !/^F\d/.test(key)) return null;     // needs a modifier (or be an F key)
    return mods.concat(key).join("+");
  }

  document.addEventListener("keydown", (e) => {
    if (!listening) return;
    if (e.preventDefault) e.preventDefault();
    if (e.key === "Escape") { stopListening(); return; }
    const accel = accelFrom(e);
    if (!accel) return;                                      // keep waiting for a real combination
    stopListening();
    window.api.setHotkey(accel);
  });

  // ---------------------------------------------------------------- join delay
  // "0 ms", "250 ms", "1.5 s", "10 s"
  function fmtDelay(ms) {
    ms = Number(ms) || 0;
    if (ms < 1000) return ms + " ms";
    const s = ms / 1000;
    return (Number.isInteger(s) ? String(s) : s.toFixed(2).replace(/0+$/, "")) + " s";
  }

  // ---------------------------------------------------------------- tabs
  const TABS = ["Channels", "Timed", "Alerts", "Settings"];
  function showTab(name) {
    TABS.forEach((n) => {
      $("tab" + n).className = "tab" + (n === name ? " active" : "");
      $("panel" + n).className = "panel" + (n === name ? "" : " hide");
    });
  }
  TABS.forEach((n) => $("tab" + n).addEventListener("click", () => showTab(n)));

  // ---------------------------------------------------------------- what was joined
  function renderJoined(j) {
    const box = $("joined");
    if (!j) { box.className = "joined hide"; return; }
    box.className = "joined";
    $("joinedTitle").textContent = "Joined";
    $("joinedTime").textContent = new Date(j.at).toLocaleTimeString();
    $("joinedWhere").textContent = j.label || "";
    $("joinedMsg").textContent = j.message || "";
    $("joinedLink").textContent = j.link || "";
  }

  // ---------------------------------------------------------------- the whole panel
  function renderGateway(g) {
    g = g || {};
    const cls = g.status === "online" ? "online" : g.status === "error" ? "error" : g.status === "connecting" ? "connecting" : "";
    $("gwStatus").textContent = g.text || "Not connected.";
    $("gwStatus").className = "gw" + (cls ? " " + cls : "");
    $("dot").className = "dot" + (cls ? " " + cls : "");
    $("gwNote").textContent = g.note || (g.hasToken ? "" : "Your token is stored encrypted on this PC and is only ever sent to Discord.");
    $("invite").textContent = g.invite ? "Add the bot to a server with this link: " + g.invite : "";
    if (document.activeElement !== $("tokenKind")) $("tokenKind").value = g.kind === "bot" ? "bot" : "user";
    $("tokenInput").placeholder = g.hasToken ? "Token saved. Paste a new one to replace it" : "Paste your token here";
  }

  function render(s) {
    if (!s) return;
    cur = s;
    const t = $("toggle");
    const timedOn = !!(s.timed && s.timed.on);
    t.textContent = timedOn ? "TIMED MODE IS ON" : s.armed ? "ARMED - click to stop" : "OFF - click to arm";
    t.className = s.armed && !timedOn ? "on" : "";
    t.disabled = timedOn;
    $("status").textContent = s.status || "";
    OPTIONS.forEach((k) => { $(k).checked = !!s[k]; });
    renderGateway(s.gateway);
    renderRules(s);
    renderSound(s);
    renderTimed(s);
    if (!listening) $("hotkeyBtn").textContent = s.hotkey || "Ctrl+Alt+S";
    renderJoined(s.joined);
    if (document.activeElement !== $("delay")) {
      $("delay").value = String(s.delayMs || 0);
      $("delayVal").textContent = fmtDelay(s.delayMs || 0);
    }
    $("version").textContent = s.version ? "v" + s.version : "";
    $("needConnect").className = "notice" + (s.gateway && s.gateway.hasToken ? " hide" : "");
  }

  window.api.getState().then(render);
  window.api.onState(render);
  window.api.onPlaySound(async (p) => { await soundReady; play(p && Number.isFinite(p.volume) ? p.volume : 70); });

  $("toggle").addEventListener("click", () => window.api.setArmed(!(cur && cur.armed)));
  OPTIONS.forEach((k) => $(k).addEventListener("change", (e) => window.api.setOption(k, e.target.checked)));
  $("addRule").addEventListener("click", () => window.api.addRule());
  $("timedToggle").addEventListener("click", () => window.api.setTimed({ on: !(cur && cur.timed && cur.timed.on) }));
  $("timedWait").addEventListener("change", () => window.api.setTimed({ waitMs: waitToMs() }));
  $("timedUnit").addEventListener("change", () => window.api.setTimed({ waitMs: waitToMs() }));

  async function connect() {
    const value = $("tokenInput").value;
    if (!value.trim()) return;
    $("tokenInput").value = "";
    await window.api.setToken(value, $("tokenKind").value);
  }
  $("connectBtn").addEventListener("click", connect);
  $("tokenInput").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
  $("disconnectBtn").addEventListener("click", () => window.api.clearToken());

  $("hotkeyBtn").addEventListener("click", () => {
    listening = true;
    $("hotkeyBtn").className = "btn key listening";
    $("hotkeyBtn").textContent = "Press keys... (Esc cancels)";
  });
  $("hotkeyReset").addEventListener("click", () => { stopListening(); window.api.setHotkey(DEFAULT_HOTKEY); });

  $("soundEnabled").addEventListener("change", (e) => window.api.setSound({ enabled: e.target.checked }));
  $("soundChoose").addEventListener("click", () => window.api.chooseSound());
  $("soundDefault").addEventListener("click", () => window.api.clearSound());
  $("volume").addEventListener("input", () => { $("volumeVal").textContent = $("volume").value + "%"; });
  $("volume").addEventListener("change", () => window.api.setSound({ volume: Number($("volume").value) }));
  $("soundTest").addEventListener("click", async () => { await soundReady; play(Number($("volume").value)); });

  $("delay").addEventListener("input", () => { $("delayVal").textContent = fmtDelay($("delay").value); });
  $("delay").addEventListener("change", () => window.api.setDelay(Number($("delay").value)));
  $("delayReset").addEventListener("click", () => {
    $("delay").value = "0";
    $("delayVal").textContent = fmtDelay(0);
    window.api.setDelay(0);
  });

  async function join() {
    const r = await window.api.joinNow($("linkInput").value);
    $("joinMsg").textContent = r && r.ok
      ? "Launching Roblox..."
      : "No supported Roblox link found in that text.";
  }
  $("joinBtn").addEventListener("click", join);
  $("linkInput").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
})();
