// 아마란스 로그인 페이지 상시 점검(자격 증명 불필요) — .github/workflows/gw-login-probe.yml이 매일 돌린다.
// 앱 자동 로그인(mobile/lib/gw/gw_login_js.dart)과 똑같은 규칙으로 1단계 DOM만 확인한다:
//   - probeJs: #reqLoginId 가 있고 disabled가 아니며 크기가 0이 아니다(보인다)
//   - fillJs : document.querySelectorAll('button') 중 폭>0 이고 innerText.trim() === "다음" 인 버튼이 있다
//              (type 속성으로 고르지 않는다 — 2026-10 아마란스가 type="submit"을 빼 자동 로그인이 멈췄다)
// 아이디·비밀번호는 넣지 않는다. 2단계(#reqLoginPw + "로그인")는 아이디를 넣어야 나와 점검하지 않는다.
// gw_login_js.dart의 셀렉터·버튼 글자를 바꾸면 여기도 같이 바꾼다.
// 실행: npm i --no-save playwright && npx playwright install chromium && node scripts/gw-login-probe.mjs
import { chromium } from "playwright";

const URL = process.env.GW_URL ?? "https://gw.innogrid.com/";
const TIMEOUT_MS = Number(process.env.GW_TIMEOUT_MS ?? 30_000);

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined }); // 로컬은 PW_CHANNEL=chrome으로 설치된 Chrome 사용 가능
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  const check = () => {
    const id = document.querySelector("#reqLoginId");
    const r = id?.getBoundingClientRect();
    const idOk = !!id && !id.disabled && r.width > 0 && r.height > 0;
    const btnOk = Array.prototype.some.call(document.querySelectorAll("button"), (b) => b.getBoundingClientRect().width > 0 && b.innerText.trim() === "다음");
    return { idOk, btnOk };
  };
  let result = { idOk: false, btnOk: false };
  try {
    await page.waitForFunction(`(() => { const r = (${check})(); return r.idOk && r.btnOk; })()`, null, { timeout: TIMEOUT_MS });
    result = { idOk: true, btnOk: true };
  } catch {
    result = await page.evaluate(check).catch(() => result);
  }
  if (result.idOk && result.btnOk) {
    console.log(`OK: ${page.url()} — #reqLoginId 보임, "다음" 버튼 있음`);
  } else {
    failed = true;
    // 공개 로그인 페이지의 구조만 남긴다(진단용 — 입력값·쿠키 없음)
    const diag = await page.evaluate(() => ({
      inputs: Array.from(document.querySelectorAll("input")).map((e) => `${e.id || "-"}/${e.type}`).slice(0, 20),
      buttons: Array.from(document.querySelectorAll("button")).map((b) => `${b.innerText.trim().slice(0, 20)}|type=${b.getAttribute("type") ?? "-"}|w=${Math.round(b.getBoundingClientRect().width)}`).slice(0, 20),
    })).catch(() => null);
    console.error(`FAIL: ${page.url()} — #reqLoginId ${result.idOk ? "OK" : "없음/안 보임"}, "다음" 버튼 ${result.btnOk ? "OK" : "없음"}`);
    console.error("진단:", JSON.stringify(diag));
    console.error("앱 자동 로그인(mobile/lib/gw/gw_login_js.dart)이 멈췄을 수 있습니다 — 로그인 페이지 변경 확인 필요.");
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
