// Turns a Roblox link found in Discord into a roblox:// launch URL.
// Returns null if the text isn't a supported link. Only digits, hex and
// dashes are ever captured, so nothing else can end up in the launched URL.
function parseRobloxLink(text) {
  if (!text) return null;
  let m;

  // Format 1: roblox://placeid=123&gameinstanceid=abc-123
  m = /roblox:\/\/placeid=(\d+)&gameinstanceid=([a-f0-9-]+)/i.exec(text);
  if (m) {
    return "roblox://experiences/start?placeId=" + m[1] + "&gameInstanceId=" + m[2];
  }

  // Format 2: https://www.roblox.com/share?code=abc123&type=Server
  m = /roblox\.com\/share(?:-links)?\?[^\r\n]*?\bcode=([a-f0-9]+)/i.exec(text);
  if (m) {
    return "roblox://navigation/share_links?code=" + m[1] + "&type=Server";
  }

  // Format 3: https://www.roblox.com/games/123/join?privateServerLinkCode=456
  m = /roblox\.com\/games\/(\d+)[^\r\n]*?privateServerLinkCode=(\d+)/i.exec(text);
  if (m) {
    return "roblox://experiences/start?placeId=" + m[1] + "&linkCode=" + m[2];
  }

  // Format 4: roblox://navigation/share_links?code=abc123&type=Server
  m = /roblox:\/\/navigation\/share_links\?[^\s]*?\bcode=([a-f0-9]+)/i.exec(text);
  if (m) {
    return "roblox://navigation/share_links?code=" + m[1] + "&type=Server";
  }

  // Format 5: roblox://experiences/start?placeId=123&linkCode=456  (or &gameInstanceId=abc-123)
  m = /roblox:\/\/experiences\/start\?[^\s]*?\bplaceId=(\d+)[^\s]*?\blinkCode=(\d+)/i.exec(text);
  if (m) {
    return "roblox://experiences/start?placeId=" + m[1] + "&linkCode=" + m[2];
  }
  m = /roblox:\/\/experiences\/start\?[^\s]*?\bplaceId=(\d+)[^\s]*?\bgameInstanceId=([a-f0-9-]+)/i.exec(text);
  if (m) {
    return "roblox://experiences/start?placeId=" + m[1] + "&gameInstanceId=" + m[2];
  }

  // Format 6: web links with placeId in the query: roblox.com/games/start?placeId=123&privateServerLinkCode=456
  // or &gameInstanceId=abc-123
  m = /roblox\.com\/[^\s]*?\bplaceId=(\d+)[^\s]*?\bprivateServerLinkCode=(\d+)/i.exec(text);
  if (m) {
    return "roblox://experiences/start?placeId=" + m[1] + "&linkCode=" + m[2];
  }
  m = /roblox\.com\/[^\s]*?\bplaceId=(\d+)[^\s]*?\bgameInstanceId=([a-f0-9-]+)/i.exec(text);
  if (m) {
    return "roblox://experiences/start?placeId=" + m[1] + "&gameInstanceId=" + m[2];
  }
  m = /roblox\.com\/games\/(\d+)[^\s]*?\bgameInstanceId=([a-f0-9-]+)/i.exec(text);
  if (m) {
    return "roblox://experiences/start?placeId=" + m[1] + "&gameInstanceId=" + m[2];
  }

  return null;
}

if (typeof module !== "undefined") module.exports = { parseRobloxLink };
