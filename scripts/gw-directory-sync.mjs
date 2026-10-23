// 아마란스 조직도 → 우리 명부(company_directory·company_departments) 동기화 — .github/workflows/gw-directory-sync.yml이 매일 돌린다.
// 1) 연동 계정(2차 인증 없음)으로 로그인 페이지에 앱 자동 로그인과 같은 규칙으로 입력(#reqLoginId → "다음" → #reqLoginPw → "로그인")
// 2) 로그인 쿠키(oAuthToken·signKey, 없으면 BIZCUBE_AT·HK)로 서명(wehago-sign)한 API 호출 — 앱 GwClient와 같은 헤더
//    gw102A01 전사 부서 트리 → 인원 있는 부서마다 gw102A02 부서원(앱 rosterRows·find_person과 같은 본문)
// 3) POST /api/admin/directory/sync {people, departments} (Bearer 수집 토큰). 서버가 50명·10부서 미만이면 거부한다.
// 아이디·비밀번호·토큰·쿠키는 출력하지 않는다. 휴대폰 번호는 보내지 않는다.
// 실행: GW_SYNC_ID=… GW_SYNC_PW=… SYNC_TOKEN=… node scripts/gw-directory-sync.mjs [--dry-run]
import { createHmac, randomBytes } from "node:crypto";
import { chromium } from "playwright";

const GW = (process.env.GW_URL ?? "https://gw.innogrid.com").replace(/\/$/, "");
const SYNC_URL = process.env.SYNC_URL ?? "https://innocrew.innogrid.com/api/admin/directory/sync";
const DRY = process.argv.includes("--dry-run");
const { GW_SYNC_ID: ID, GW_SYNC_PW: PW, SYNC_TOKEN: TOKEN } = process.env;
if (!ID || !PW) throw new Error("GW_SYNC_ID·GW_SYNC_PW가 필요합니다");
if (!DRY && !TOKEN) throw new Error("SYNC_TOKEN이 필요합니다(--dry-run이 아니면)");

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** 로그인 → 크레덴셜 { authToken, signKey }. 앱 gw_login_js.dart와 같은 입력 방식(React 입력칸은 네이티브 setter + input 이벤트). */
async function login() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
    const page = await ctx.newPage();
    await page.goto(`${GW}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const fill = (selector, value, submitText) =>
      page.evaluate(
        ([selector, value, submitText]) => {
          const el = document.querySelector(selector);
          if (!el) return "no-field";
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          const btn = Array.prototype.find.call(document.querySelectorAll("button"), (b) => b.getBoundingClientRect().width > 0 && b.innerText.trim() === submitText);
          if (!btn) return "no-button";
          setTimeout(() => btn.click(), 80);
          return "ok";
        },
        [selector, value, submitText],
      );
    const visible = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.disabled) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`;
    await page.waitForFunction(visible("#reqLoginId"), null, { timeout: 60_000 });
    const r1 = await fill("#reqLoginId", ID, "다음");
    if (r1 !== "ok") throw new Error(`로그인 1단계 실패(${r1}) — 로그인 페이지가 바뀌었는지 gw-login-probe 확인`);
    await page.waitForFunction(visible("#reqLoginPw"), null, { timeout: 30_000 });
    const r2 = await fill("#reqLoginPw", PW, "로그인");
    if (r2 !== "ok") throw new Error(`로그인 2단계 실패(${r2})`);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const m = Object.fromEntries((await ctx.cookies(GW)).map((c) => [c.name, decodeURIComponent(c.value)]));
      const authToken = m.oAuthToken ?? m.BIZCUBE_AT, signKey = m.signKey ?? m.BIZCUBE_HK;
      if (authToken && signKey) return { authToken, signKey };
      const err = await page
        .evaluate(() => Array.from(document.querySelectorAll("p")).filter((p) => p.getBoundingClientRect().height > 0 && /비밀번호|아이디|오류|잘못|실패|일치|인증/.test(p.innerText)).map((p) => p.innerText.trim()).join(" ").slice(0, 80))
        .catch(() => "");
      if (err) throw new Error(`로그인 거부: ${err}`);
      await page.waitForTimeout(1000);
    }
    throw new Error("로그인 뒤 인증 쿠키를 받지 못했습니다(2차 인증·안내 화면 확인)");
  } finally {
    await browser.close();
  }
}

/** 앱 GwClient._signed와 같은 서명 POST(JSON). resultCode 0/200만 성공. */
async function call(creds, path, body) {
  const tid = randomBytes(16).toString("hex");
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = createHmac("sha256", creds.signKey).update(`${creds.authToken}${tid}${ts}${path}`).digest("base64");
  const res = await fetch(`${GW}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.authToken}`, timestamp: ts, "transaction-id": tid, "wehago-sign": sign, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({}));
  const code = Number(j.resultCode ?? -1);
  if (!res.ok || (code !== 0 && code !== 200)) throw new Error(`${path} 실패 (HTTP ${res.status}, resultCode ${code})`);
  return j.resultData;
}

const rows = (d, key) => (Array.isArray(key ? d?.[key] : d) ? (key ? d[key] : d) : []).filter((r) => r && typeof r === "object");

async function main() {
  const creds = await login();
  console.log("로그인 완료");
  const tree = rows(
    await call(creds, "/gw/APIHandler/gw102A01", { parentSeq: "0", popupType: "main", selectedType: "tree", isAllCompShow: false, compFilter: "", isTreeChecked: "", isTreeAllOpen: true, isPartYn: false }),
    "treeList",
  );
  // 부서 트리 — path "1000|20|30|"의 마지막 앞이 상위, 깊이는 회사 루트 0. 회사(c)·부서(d)만, 순서는 받은 순서.
  const departments = [];
  tree.forEach((t, i) => {
    if (!["c", "d"].includes(str(t.orgGubun))) return;
    const ids = str(t.path).split("|").filter(Boolean);
    departments.push({ id: str(t.id), parentId: ids.length >= 2 ? ids[ids.length - 2] : null, name: str(t.text), path: str(t.path), sort: i, depth: Math.max(0, ids.length - 1) });
  });
  const depts = tree.filter((t) => str(t.orgGubun) === "d" && Number(t.childUserCnt) > 0).map((t) => str(t.id));
  const seen = new Set();
  const people = [];
  let failed = 0;
  for (let i = 0; i < depts.length; i += 8) {
    const batch = await Promise.all(
      depts.slice(i, i + 8).map((id) =>
        call(creds, "/gw/APIHandler/gw102A02", {
          selectedId: id, orgGubun: "d", popupType: "main", selectedType: "tree", searchDiv: "all", searchText: "",
          isBdayOption: "1", isJoinDayOption: "0", isOrganizationDisplayOption: "5|0|1|3|", isGridListDisplayOption: "0", isLoginIdOption: "1",
        }).catch(() => { failed++; return []; }),
      ),
    );
    for (const list of batch) {
      for (const r of rows(list)) {
        const emp = str(r.empSeq);
        if (!emp || seen.has(emp)) continue;
        seen.add(emp);
        // find_person과 같은 항목(휴대폰 번호 제외)
        people.push({ empSeq: emp, name: str(r.empName), loginId: str(r.loginId), email: str(r.emailAddr), deptId: str(r.deptSeq), deptName: str(r.deptName), deptPath: str(r.pathName), duty: str(r.dutyName), dutyCode: str(r.dutyCode), position: str(r.positionName) });
      }
    }
  }
  console.log(`부서 ${departments.length}개 · 인원 있는 부서 ${depts.length}개 중 실패 ${failed} · 인원 ${people.length}명(이메일 있음 ${people.filter((p) => p.email.includes("@")).length}명)`);
  if (failed > 0) throw new Error(`부서원 조회 ${failed}건 실패 — 부분 명부로 비활성 처리하지 않도록 반영하지 않습니다`);
  if (DRY) return;
  const res = await fetch(SYNC_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source: "amaranth", query: "gw102A02(gha)", note: "github-actions", people, departments }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`반영 실패 (HTTP ${res.status}): ${j.error ?? ""}`);
  console.log(`반영: ${j.total}명(비활성 ${j.deactivated}) · 부서 ${j.departments}개 · 건너뜀 ${j.skipped}`);
}

main().catch((e) => {
  console.error(`FAIL: ${e.message}`);
  process.exit(1);
});
