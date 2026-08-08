// extension/background.js
// content script로부터 GW 세션 요청을 받아 gw.innogrid.com 쿠키를 읽어 응답.
const GW_URL = "https://gw.innogrid.com";

function getCookie(name) {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: GW_URL, name }, (c) => resolve(c && c.value ? c.value : null));
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "GW_SESSION_REQUEST") return;
  (async () => {
    try {
      const [oAuthToken, signKey] = await Promise.all([
        getCookie("oAuthToken"),
        getCookie("signKey"),
      ]);
      if (!oAuthToken || !signKey) {
        sendResponse({ error: "GW 세션을 찾을 수 없습니다. gw.innogrid.com에 먼저 로그인하세요." });
      } else {
        sendResponse({ data: { oAuthToken, signKey } });
      }
    } catch (e) {
      sendResponse({ error: String(e) });
    }
  })();
  return true; // async sendResponse
});
