// extension/background.js
// GW 세션 요청 시: gw.innogrid.com 쿠키(oAuthToken/signKey) + localStorage의 이메일을 읽어 응답.
const GW_URL = "https://gw.innogrid.com";
const APP_ORIGIN_RE_VERCEL = /^https:\/\/inje-playground\.vercel\.app(\/|$)/;
const APP_ORIGIN_RE_LOCAL = /^http:\/\/localhost(:\d+)?(\/|$)/;

function getCookie(name) {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: GW_URL, name }, (c) => resolve(c && c.value ? c.value : null));
  });
}

async function getGwEmail() {
  const tabs = await chrome.tabs.query({ url: "https://gw.innogrid.com/*" });
  if (!tabs.length || !tabs[0].id) return null;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => localStorage.getItem("DUZON_BIZCUBEX_SSO_PARAMS"),
    });
    const raw = res && res.result;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ci = parsed.companyInfo || {};
    if (ci.emailAddr && ci.emailDomain) return `${ci.emailAddr}@${ci.emailDomain}`;
    return null;
  } catch (_e) {
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "GW_SESSION_REQUEST") return;
  const senderUrl = (sender && (sender.url || sender.origin)) || "";
  const ok = APP_ORIGIN_RE_VERCEL.test(senderUrl) || APP_ORIGIN_RE_LOCAL.test(senderUrl);
  if (!ok) { sendResponse({ error: "unauthorized origin" }); return true; }
  (async () => {
    try {
      const [oAuthToken, signKey, email] = await Promise.all([
        getCookie("oAuthToken"),
        getCookie("signKey"),
        getGwEmail(),
      ]);
      if (!oAuthToken || !signKey) {
        sendResponse({ error: "GW 세션을 찾을 수 없습니다. gw.innogrid.com에 먼저 로그인하세요." });
        return;
      }
      if (!email) {
        sendResponse({ error: "GW 사용자 정보를 찾을 수 없습니다. gw.innogrid.com 탭이 열려 있고 로그인되어 있는지 확인하세요." });
        return;
      }
      sendResponse({ data: { oAuthToken, signKey, email } });
    } catch (_e) {
      sendResponse({ error: "GW 세션 조회 중 오류가 발생했습니다." });
    }
  })();
  return true; // async sendResponse
});
