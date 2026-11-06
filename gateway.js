"use strict";
// Listens to Discord's live message feed (the "gateway") with a token and hands every
// new message to onMessage. No window, no page scraping. Works with a bot token
// (mode "bot") or an account token (mode "user").
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const BOT_INTENTS = 1 | (1 << 9) | (1 << 15);   // guilds + guild messages + message content

const FATAL = {
  4004: "Discord rejected the token. Check it and connect again.",
  4010: "Discord refused the connection (bad shard).",
  4011: "Discord refused the connection (sharding required).",
  4012: "Discord refused the connection (bad API version).",
  4013: "Discord refused the connection (invalid intents).",
  4014: 'The bot is not allowed to read message text. In the Discord developer portal open your bot, then turn ON "Message Content Intent".'
};

const USER_PROPERTIES = {
  os: "Windows", browser: "Chrome", device: "", system_locale: "en-US",
  browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  browser_version: "130.0.0.0", os_version: "10", referrer: "", referring_domain: "",
  release_channel: "stable", client_build_number: 0, client_event_source: null
};

function createGateway(o) {
  const WS = o.WebSocket;
  const token = String(o.token);
  const mode = o.mode === "bot" ? "bot" : "user";
  const onMessage = o.onMessage || (() => {});
  const onStatus = o.onStatus || (() => {});
  const onReady = o.onReady || (() => {});
  const st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout;
  const si = o.setInterval || setInterval, ci = o.clearInterval || clearInterval;

  let sock = null, seq = null, sessionId = null, resumeUrl = null;
  let hbTimer = null, hbFirst = null, acked = true, stopped = true;
  let retry = 0, retryTimer = null, user = null;
  let subs = [];                                   // [{ guildId, channelId }] for account mode

  function send(obj) {
    try { if (sock) sock.send(JSON.stringify(obj)); } catch (e) { /* socket closing */ }
  }

  function clearHeartbeat() {
    if (hbFirst) ct(hbFirst);
    if (hbTimer) ci(hbTimer);
    hbFirst = hbTimer = null;
  }

  function heartbeat() { send({ op: 1, d: seq }); acked = false; }

  function identify() {
    if (mode === "bot") {
      send({ op: 2, d: { token, intents: BOT_INTENTS, properties: { os: "windows", browser: "rbx-auto-join", device: "rbx-auto-join" } } });
    } else {
      send({ op: 2, d: {
        token, capabilities: 16381, properties: USER_PROPERTIES, compress: false,
        presence: { status: "online", since: 0, activities: [], afk: false },
        client_state: { guild_versions: {} }
      } });
    }
  }

  // Account mode: like the Discord app, tell Discord which channels we are looking at,
  // so message events are sent for them even in big servers.
  function sendSubscriptions() {
    if (mode !== "user") return;
    const byGuild = new Map();
    subs.forEach((s) => {
      if (!s.guildId || !s.channelId) return;
      if (!byGuild.has(s.guildId)) byGuild.set(s.guildId, {});
      byGuild.get(s.guildId)[s.channelId] = [[0, 99]];
    });
    byGuild.forEach((channels, guildId) => {
      send({ op: 14, d: { guild_id: guildId, typing: true, threads: false, activities: false, members: [], channels } });
    });
  }

  function connect() {
    stopped = false;
    const url = sessionId && resumeUrl ? resumeUrl.replace(/\/*$/, "") + "/?v=10&encoding=json" : (o.url || GATEWAY);
    const mine = new WS(url);
    sock = mine;
    mine.on("open", () => {});
    mine.on("message", (data) => { if (sock === mine) handle(data); });
    mine.on("error", (err) => {
      if (sock === mine) onStatus("connecting", "Connection problem (" + ((err && err.message) || err) + "). Retrying...");
    });
    mine.on("close", (code) => { if (sock === mine) closed(code); });
  }

  function closed(code) {
    clearHeartbeat();
    sock = null;
    if (FATAL[code]) { stopped = true; onStatus("error", FATAL[code]); return; }
    if (code === 4007 || code === 4009) { sessionId = null; seq = null; }
    reconnectSoon(Math.min(1000 * Math.pow(2, retry++), 15000));
  }

  function reconnectSoon(ms) {
    if (stopped) return;
    onStatus("connecting", "Reconnecting...");
    if (retryTimer) ct(retryTimer);
    retryTimer = st(() => { retryTimer = null; if (!stopped) connect(); }, ms);
  }

  // Drop the current socket and come back (keeping the session when we can resume it).
  function dropAndReconnect(keepSession, ms) {
    clearHeartbeat();
    const old = sock;
    sock = null;
    if (old) { try { old.terminate ? old.terminate() : old.close(); } catch (e) { /* already closed */ } }
    if (!keepSession) { sessionId = null; seq = null; }
    reconnectSoon(ms);
  }

  function handle(raw) {
    let p;
    try { p = JSON.parse(String(raw)); } catch (e) { return; }
    if (!p || typeof p !== "object") return;
    if (typeof p.s === "number") seq = p.s;

    switch (p.op) {
      case 10: {
        const every = (p.d && p.d.heartbeat_interval) || 41250;
        clearHeartbeat();
        acked = true;
        hbFirst = st(() => {
          hbFirst = null;
          heartbeat();
          hbTimer = si(() => {
            if (!acked) { dropAndReconnect(true, 500); return; }   // connection went silent
            heartbeat();
          }, every);
        }, Math.floor(every * Math.random()));
        if (sessionId && seq !== null) send({ op: 6, d: { token, session_id: sessionId, seq } });
        else identify();
        break;
      }
      case 11: acked = true; break;
      case 1: heartbeat(); break;
      case 7: dropAndReconnect(true, 300); break;
      case 9: dropAndReconnect(p.d === true, 1000 + Math.floor(Math.random() * 4000)); break;
      case 0: dispatch(p.t, p.d); break;
      default: break;
    }
  }

  function dispatch(t, d) {
    if (t === "READY") {
      sessionId = d && d.session_id;
      resumeUrl = d && d.resume_gateway_url;
      user = (d && d.user) || null;
      retry = 0;
      onStatus("online", "Connected as " + ((user && (user.global_name || user.username)) || "Discord") + ".");
      onReady(user);
      sendSubscriptions();
    } else if (t === "RESUMED") {
      retry = 0;
      onStatus("online", "Connected as " + ((user && (user.global_name || user.username)) || "Discord") + ".");
      sendSubscriptions();
    } else if (t === "MESSAGE_CREATE" || t === "MESSAGE_UPDATE") {
      if (d && typeof d === "object") onMessage(d, t, user);
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false; seq = null; sessionId = null; retry = 0;
      onStatus("connecting", "Connecting...");
      connect();
    },
    stop() {
      stopped = true;
      clearHeartbeat();
      if (retryTimer) ct(retryTimer);
      retryTimer = null;
      const old = sock;
      sock = null;
      if (old) { try { old.close(); } catch (e) { /* already closed */ } }
      onStatus("off", "Not connected.");
    },
    // Channels to ask Discord for message events on (account mode).
    subscribe(list) {
      subs = Array.isArray(list) ? list.slice(0, 50) : [];
      if (sock && sessionId) sendSubscriptions();
    },
    isStopped: () => stopped
  };
}

module.exports = { createGateway, FATAL, GATEWAY };
