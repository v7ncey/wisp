import { API_URL } from "./config";

// The content script asks the background worker to call the Wisp server, so the request
// comes from the extension (not the host page) and only goes to Wisp's own server.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "wisp:personalize") return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(msg.body),
    signal: ctrl.signal,
  })
    .then((r) => r.json())
    .then(reply)
    .catch(() => reply({ source: "built-in", reason: "offline" }))
    .finally(() => clearTimeout(t));
  return true; // async reply
});
