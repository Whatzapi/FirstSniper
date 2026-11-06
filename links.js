"use strict";
// Finds the Roblox link in a Discord message (as Discord's gateway sends it) and
// returns the message's text for keyword matching. Hidden links count too:
// "[click here](https://roblox.com/...)" arrives with the real address in the raw
// message text, and links can also sit in embeds, link buttons and forwarded messages.
const { parseRobloxLink } = require("./parse");

const INVISIBLE = /[\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]/g;
// A link-looking word: with a scheme, or a bare roblox.com address. It stops at spaces,
// brackets, quotes, <> and | so markdown, <links> and ||spoilers|| are peeled off.
const CAND_RE = /(?:https?:\/\/|roblox:\/\/)[^\s<>()\[\]"'|]+|(?:[a-z0-9-]+\.)*roblox\.com\/[^\s<>()\[\]"'|]+/gi;

function clean(s) {
  return String(s == null ? "" : s)
    .replace(INVISIBLE, "")
    .replace(/&amp;/gi, "&")
    .replace(/\\([_*~`|\\<>\[\]()])/g, "$1");
}

// Every piece of text in a message, in reading order.
function pieces(msg) {
  const out = [];
  const add = (v) => { if (typeof v === "string" && v) out.push(v); };
  const addMessage = (m) => {
    if (!m || typeof m !== "object") return;
    add(m.content);
    (Array.isArray(m.embeds) ? m.embeds : []).forEach((e) => {
      if (!e || typeof e !== "object") return;
      add(e.url); add(e.title); add(e.description);
      if (e.author) { add(e.author.name); add(e.author.url); }
      (Array.isArray(e.fields) ? e.fields : []).forEach((f) => { if (f) { add(f.name); add(f.value); } });
      if (e.footer) add(e.footer.text);
    });
    walkComponents(m.components, 0);
  };
  const walkComponents = (list, depth) => {
    if (!Array.isArray(list) || depth > 6) return;
    list.forEach((c) => {
      if (!c || typeof c !== "object") return;
      add(c.url); add(c.label); add(c.content);
      walkComponents(c.components, depth + 1);
      if (c.accessory) walkComponents([c.accessory], depth + 1);
    });
  };
  addMessage(msg);
  (Array.isArray(msg && msg.message_snapshots) ? msg.message_snapshots : []).forEach((s) => addMessage(s && s.message));
  return out;
}

// The first Roblox link in the message, or null: { url, raw }.
// `url` is the roblox:// address to launch, `raw` is the text it was read from.
function extractRobloxLink(msg) {
  for (const piece of pieces(msg)) {
    const text = clean(piece);
    const found = text.match(CAND_RE) || [];
    for (const cand of found) {
      const tries = [cand];
      if (/%[0-9a-f]{2}/i.test(cand)) { try { tries.push(decodeURIComponent(cand)); } catch (e) { /* not encoded */ } }
      for (const c of tries) {
        const url = parseRobloxLink(c);
        if (url) return { url, raw: c };
      }
    }
  }
  return null;
}

// What keywords are matched against: the message text, embeds and so on.
function messageText(msg) {
  return pieces(msg).map(clean).join(" ").replace(/\s+/g, " ").trim().slice(0, 8000);
}

module.exports = { extractRobloxLink, messageText };
