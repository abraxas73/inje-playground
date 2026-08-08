// extension/content.js
// 우리 앱 페이지에만 주입됨(manifest matches). window.postMessage ↔ chrome.runtime 브리지.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== "gw-bridge" || msg.type !== "GW_SESSION_REQUEST") return;
  chrome.runtime.sendMessage({ type: "GW_SESSION_REQUEST" }, (resp) => {
    window.postMessage(
      {
        source: "gw-bridge-ext",
        type: "GW_SESSION_RESPONSE",
        id: msg.id,
        data: resp?.data,
        error: resp?.error || (chrome.runtime.lastError && chrome.runtime.lastError.message),
      },
      window.location.origin
    );
  });
});
