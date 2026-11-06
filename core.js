"use strict";
// The brain of the app: no Electron in here, so it can be tested on its own.
// It decides when a link is allowed to launch Roblox, and keeps the status text.
const { parseRobloxLink } = require("./parse");

const OPTION_KEYS = ["oneShot", "onTop", "alert"];
const MAX_DELAY_MS = 10000;
const MIN_WAIT_MS = 1000;                 // timed mode: shortest and longest wait before it arms again
const MAX_WAIT_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_MS = 60000; // the same link within this time is ignored

// Keywords are typed as a list separated by commas or new lines; capitals never matter.
//   vip            the message must contain at least one of the plain words
//   +vip           the message MUST contain this word (every + word is needed)
//   -scam          the message must NOT contain this word
//   /re(gex)?/i    a pattern instead of a word (works with + and - too)
//   "private server"  quotes around a phrase are optional
// Returns "" when no keyword is set (every message counts) or only "-" words are set and
// none appear; the word/pattern that matched (as typed); or null when the message fails.
function parseKeywords(keywords) {
  const out = { any: [], must: [], not: [] };
  String(keywords || "").split(/[,\n]/).forEach((raw) => {
    let k = raw.trim();
    if (!k) return;
    let kind = "any";
    if (k[0] === "+") { kind = "must"; k = k.slice(1).trim(); }
    else if (k[0] === "-") { kind = "not"; k = k.slice(1).trim(); }
    k = k.replace(/^"(.*)"$/, "$1").trim();
    if (!k) return;
    const m = /^\/(.{1,100})\/([imsu]*)$/.exec(k);
    let test;
    if (m) {
      let re;
      try { re = new RegExp(m[1], m[2].includes("i") ? m[2] : m[2] + "i"); } catch (e) { return; }   // a broken pattern is ignored
      test = (hay) => re.test(hay);
    } else {
      const low = k.toLowerCase();
      test = (hay) => hay.toLowerCase().includes(low);
    }
    out[kind].push({ label: k, test });
  });
  return out;
}

function findKeyword(text, keywords) {
  const p = parseKeywords(keywords);
  if (!p.any.length && !p.must.length && !p.not.length) return "";
  const hay = String(text || "");
  if (p.not.some((x) => x.test(hay))) return null;
  if (p.must.some((x) => !x.test(hay))) return null;
  let label = p.must.length ? p.must[0].label : "";
  if (p.any.length) {
    const hit = p.any.find((x) => x.test(hay));
    if (!hit) return null;
    label = hit.label;
  }
  return label;
}

// "0 ms", "250 ms", "1.5 s", "10 s"
function formatDelay(ms) {
  if (ms < 1000) return ms + " ms";
  const s = ms / 1000;
  return (Number.isInteger(s) ? String(s) : s.toFixed(2).replace(/0+$/, "")) + " s";
}

function createCore(opts) {
  opts = opts || {};
  const launch = opts.launch || (() => {});
  const now = opts.now || Date.now;
  const onChange = opts.onChange || (() => {});
  const onJoin = opts.onJoin || (() => {});      // called after an automatic join (for the alert)
  const setTimer = opts.setTimer || setTimeout;
  const clearTimer = opts.clearTimer || clearTimeout;

  const state = {
    armed: false,          // never restored from a previous run
    oneShot: true,         // switch off after the first join
    onTop: false,
    alert: true,           // notify + sound when it joins
    delayMs: 0,            // wait this long after a match before opening Roblox (0 - 10000)
    // Timed mode: one channel that is armed, joins once, then arms itself again after
    // `waitMs`. It is never restored switched on, and while it is on the ARMED button is off.
    timed: { on: false, armed: false, waitMs: 60000, nextAt: 0 },
    lastJoin: "",
    joined: null,          // what the last join was: { at, label, message, link }
    status: "Off. Click the big button to arm."
  };
  const initial = opts.initial || {};
  for (const k of OPTION_KEYS) if (typeof initial[k] === "boolean") state[k] = initial[k];
  const clampDelay = (v) => Math.max(0, Math.min(MAX_DELAY_MS, Math.round(Number(v) || 0)));
  const clampWait = (v) => Math.max(MIN_WAIT_MS, Math.min(MAX_WAIT_MS, Math.round(Number(v) || 0)));
  state.delayMs = clampDelay(initial.delayMs);
  if (initial.timedWaitMs !== undefined) state.timed.waitMs = clampWait(initial.timedWaitMs);

  const pending = new Set();           // joins that are waiting out the delay
  let rearmTimer = null;               // timed mode: the "arm again" timer
  let lastLaunch = { text: "", at: 0 };

  const snapshot = () => Object.assign({}, state, { timed: Object.assign({}, state.timed) });
  const emit = () => onChange(snapshot());
  const clock = () => new Date(now()).toLocaleTimeString();

  function cancelPending() {
    pending.forEach((h) => clearTimer(h));
    pending.clear();
  }

  function fail(e) {
    state.status = "Could not open Roblox: " + ((e && e.message) || e) + ". Is it installed?";
    emit();
  }

  // `label` is only used in the status text. `manual` joins never change any switch.
  // extra: { always } this channel joins even when unarmed; { timed } the timed-mode
  // channel; { applyDelay: false } this channel skips the join delay.
  function join(label, text, manual, message, extra) {
    extra = extra || {};
    const url = parseRobloxLink(text);
    if (!url) return { ok: false, reason: "no-link" };

    const t = now();
    const key = String(text).trim();
    if (!manual && lastLaunch.text === key && t - lastLaunch.at < DUPLICATE_MS) {
      return { ok: false, reason: "duplicate" };
    }
    lastLaunch = { text: key, at: t };

    // Decide first, launch after: switching off before launching means nothing else
    // can sneak in a second join, even while this one is waiting out the delay.
    if (!manual && !extra.always && !extra.timed && state.oneShot) state.armed = false;
    if (extra.timed) state.timed.armed = false;

    const go = () => {
      state.lastJoin = key.slice(0, 200);
      state.joined = { at: now(), label: String(label), message: String(message || "").replace(/\s+/g, " ").trim().slice(0, 500), link: key.slice(0, 300) };
      state.status = "Launching Roblox (from " + label + ") at " + clock() + ".";
      if (extra.timed && state.timed.on) {
        // the wait until this channel is armed again starts now
        state.timed.nextAt = now() + state.timed.waitMs;
        if (rearmTimer) clearTimer(rearmTimer);
        rearmTimer = setTimer(() => {
          rearmTimer = null;
          if (!state.timed.on) return;
          state.timed.armed = true;
          state.timed.nextAt = 0;
          state.status = "Timed mode: armed again.";
          emit();
        }, state.timed.waitMs);
      }
      try {
        const p = launch(url);
        if (p && typeof p.catch === "function") p.catch(fail);
      } catch (e) {
        fail(e);
        return;
      }
      emit();
      if (!manual) { try { onJoin({ label, url, text: key }); } catch (e) { /* an alert problem must never matter */ } }
    };

    const delay = manual || extra.applyDelay === false ? 0 : state.delayMs;
    if (delay > 0) {
      state.status = "Joining in " + formatDelay(delay) + " (from " + label + ")." + (extra.always || extra.timed ? "" : " Press the big button to cancel.");
      const h = setTimer(() => { pending.delete(h); go(); }, delay);
      pending.add(h);
      emit();
      return { ok: true, url, delayed: delay };
    }
    go();
    return { ok: true, url };
  }

  return {
    getState: snapshot,

    // The big button / shortcut. Any press while a join is waiting out its delay
    // cancels that join (and leaves the app off) instead of arming.
    setArmed(on) {
      if (state.timed.on) {
        state.status = "Timed mode is on, so this button is off. Switch Timed mode off in the Timed tab first.";
        emit();
        return;
      }
      if (pending.size) {
        cancelPending();
        state.armed = false;
        state.status = "Cancelled the pending join. Off.";
        emit();
        return;
      }
      state.armed = !!on;
      state.status = state.armed ? "Armed. Watching your Discord channels." : "Off.";
      emit();
    },

    setOption(key, value) {
      if (!OPTION_KEYS.includes(key)) return false;
      state[key] = !!value;
      emit();
      return true;
    },

    // Timed mode: { on, waitMs }. Switching it on disables the ARMED button (and turns
    // it off); switching it off cancels any waiting join and the arm-again timer.
    setTimed(patch) {
      patch = patch || {};
      if (patch.waitMs !== undefined) state.timed.waitMs = clampWait(patch.waitMs);
      if (typeof patch.on === "boolean" && patch.on !== state.timed.on) {
        cancelPending();
        if (rearmTimer) { clearTimer(rearmTimer); rearmTimer = null; }
        state.timed.on = patch.on;
        state.timed.armed = patch.on;
        state.timed.nextAt = 0;
        if (patch.on) {
          state.armed = false;
          state.status = "Timed mode is on. Armed for the timed channel.";
        } else {
          state.status = "Timed mode is off.";
        }
      }
      emit();
    },

    // A watched Discord channel got a brand-new message with a link. `opts.text` is the
    // message's text, `opts.keyword` the channel's keyword list (with one set, the message
    // must contain one of them, otherwise the link is skipped) and `opts.label` names the
    // channel for the status text and the alert. `opts.always` joins even when unarmed,
    // `opts.timed` is the timed-mode channel and `opts.applyDelay === false` skips the delay.
    fromDiscord(href, opts) {
      opts = opts || {};
      if (opts.timed) {
        if (!state.timed.on || !state.timed.armed) return { ok: false, reason: "off" };
      } else if (!opts.always && (state.timed.on || !state.armed)) {
        return { ok: false, reason: "off" };
      }
      const found = findKeyword(opts.text, opts.keyword);
      if (found === null) return { ok: false, reason: "keyword" };
      const where = opts.label || "Discord";
      return join(found ? where + ', keyword "' + found + '"' : where, href, false, opts.text,
        { always: !!opts.always, timed: !!opts.timed, applyDelay: opts.applyDelay });
    },

    // The "paste a link and join" box: for links you paste yourself. Instant, and it
    // works whether or not the app is armed.
    joinNow(text) {
      return join("the link you pasted", String(text || ""), true);
    },

    setDelay(ms) {
      state.delayMs = clampDelay(ms);
      emit();
    },

    note(text) {
      state.status = String(text);
      emit();
    }
  };
}

module.exports = { createCore, findKeyword, formatDelay, OPTION_KEYS, MAX_DELAY_MS, MIN_WAIT_MS, MAX_WAIT_MS };
