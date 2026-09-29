#!/usr/bin/env node
// frontend/scripts/claude-seat-executor.mjs
// Claude 시트 할당·해제 실행기 — 관리자 Mac에서 상시 실행(launchd com.innogrid.claude-seat-executor).
//   node scripts/claude-seat-executor.mjs            # 15초마다 대기 요청을 claim해 claude.ai에 반영
//   node scripts/claude-seat-executor.mjs --login    # 창을 띄워 소유자 계정으로 직접 로그인(1회). 창을 닫으면 끝
//   node scripts/claude-seat-executor.mjs --once     # 한 행만 처리하고 종료(점검용)
// 환경: CLAUDE_OTEL_INGEST_TOKEN(없으면 frontend/.env.local → ~/.config/inje-playground/work-metrics.env),
//       APP_URL(기본 프로덕션), SEAT_PROFILE_DIR(기본 ~/.claude-seat/profile), SEAT_HEADLESS(기본 1)
// 서버 계약: GET ?claim=1 → {row}, PATCH {id,status,before_tier,after_tier,error,executor}, PUT heartbeat — src/app/api/admin/claude-usage/seat-actions
// 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md §6
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TIER_TO_API, findMember, readToken } from "./lib/claude-seat.mjs";

const VERSION = "2026-09-29.1";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = (process.env.APP_URL || "https://inje-playground.vercel.app").replace(/\/$/, "");
const PROFILE = process.env.SEAT_PROFILE_DIR || path.join(os.homedir(), ".claude-seat", "profile");
const HEADLESS = process.env.SEAT_HEADLESS !== "0";
const POLL_MS = 15_000;
const HOST = os.hostname();
const API = `${APP_URL}/api/admin/claude-usage/seat-actions`;
let busy = false;
let stopping = false;
let loginAt = 0;
let loginOk = false;

const log = (obj) => console.log(JSON.stringify({ t: new Date().toISOString(), ...obj }));

const token = readToken([path.join(HERE, "..", ".env.local"), path.join(os.homedir(), ".config", "inje-playground", "work-metrics.env")]);
if (!token) { console.error("CLAUDE_OTEL_INGEST_TOKEN이 없습니다(env 또는 frontend/.env.local)"); process.exit(1); }

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 본문이 JSON이 아님 */ }
  if (!r.ok) {
    const err = new Error(`${method} ${url} → ${r.status} ${json?.error ?? text.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return json;
}
const heartbeat = (logged_in, note) => api("PUT", `${API}/heartbeat`, { logged_in, note: note ?? null, host: HOST, version: VERSION }).catch((e) => log({ heartbeat_error: e.message }));

/** PATCH를 최대 5번 더(총 6회) 재시도 — 5s·15s·30s·60s·120s 간격. claude.ai에는 이미 반영된 뒤 결과 보고만 실패하는 상황(일시적 5xx·네트워크 오류)에 결과가 유실되지 않게 한다 */
async function patchWithRetry(body) {
  const waits = [5_000, 15_000, 30_000, 60_000, 120_000];
  for (let n = 0; ; n++) {
    try { return await api("PATCH", API, body); }
    catch (e) {
      if (e.status && e.status < 500) throw e; // 4xx(이미 끝난 요청 등)는 재시도해도 안 바뀜
      log({ patch_retry: n, error: e.message });
      if (n >= waits.length) throw e;
      await sleep(waits[n]);
    }
  }
}

async function launch(headless) {
  fs.mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  const opts = { headless, args: ["--disable-blink-features=AutomationControlled"], viewport: { width: 1280, height: 900 } };
  try { return await chromium.launchPersistentContext(PROFILE, { ...opts, channel: "chrome" }); } // 로컬 Chrome 우선
  catch { return chromium.launchPersistentContext(PROFILE, opts); }                                  // 없으면 Playwright Chromium
}

/** claude.ai 페이지 안에서 fetch — 소유자 세션 쿠키가 붙는다. 반환은 {status, json|text} */
async function claudeFetch(page, url, init) {
  return page.evaluate(async ({ url, init }) => {
    const r = await fetch(url, { credentials: "include", ...init });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text: text.slice(0, 200) };
  }, { url, init: init ?? {} });
}

async function ensureClaudePage(ctx) {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  // Cloudflare 확인은 실제 창(headed)에서만 풀린다(2026-09-29: 헤드리스는 API 경로까지 403 challenge) — 래퍼는 SEAT_HEADLESS=0
  if (!page.url().startsWith("https://claude.ai")) await page.goto("https://claude.ai/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (Date.now() - loginAt > 60_000) { // 로그인 확인은 60초 캐시 — 매 15초 루프마다 호출하지 않는다
    const r = await claudeFetch(page, "/api/organizations");
    loginAt = Date.now();
    loginOk = r.status === 200;
    if (!loginOk) log({ login_check: r.status, url: page.url().slice(0, 60), head: String(r.text ?? "").slice(0, 80) });
  }
  return { page, loggedIn: loginOk };
}

async function process1(page, row) {
  const org = row.org_id;
  const target = row.action === "unassign" ? "unassigned" : TIER_TO_API[row.target_tier];
  if (!target) return { status: "failed", error: `모르는 목표 티어: ${row.target_tier}` };
  let putOk = false;
  let before = null;
  try {
    const beforeRes = await claudeFetch(page, `/api/organizations/${org}/members?limit=500`);
    if (beforeRes.status !== 200) return { status: "failed", error: `claude.ai members ${beforeRes.status}: ${beforeRes.text}` };
    const m = findMember(beforeRes.json, row.email);
    if (!m || !m.uuid) return { status: "failed", error: "조직에서 멤버를 찾지 못했습니다" };
    before = m.seat_tier;
    const put = await claudeFetch(page, `/api/organizations/${org}/members/${m.uuid}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seat_tier: target }) });
    if (put.status < 200 || put.status >= 300) return { status: "failed", before_tier: before, error: `claude.ai ${put.status}: ${put.text}` };
    putOk = true;
    const after = await claudeFetch(page, `/api/organizations/${org}/members?limit=500`);
    const m2 = after.status === 200 ? findMember(after.json, row.email) : null;
    if (!m2) return { status: "failed", before_tier: before, error: `${putOk ? "claude.ai에는 이미 반영됨(PUT 2xx) — " : ""}적용 뒤 멤버를 다시 읽지 못했습니다` };
    if (m2.seat_tier !== target) return { status: "failed", before_tier: before, after_tier: m2.seat_tier, error: `${putOk ? "claude.ai에는 이미 반영됨(PUT 2xx) — " : ""}적용 후 티어가 ${m2.seat_tier}입니다` };
    return { status: "done", before_tier: before, after_tier: m2.seat_tier };
  } catch (e) {
    return { status: "failed", before_tier: before, error: `${putOk ? "claude.ai에는 이미 반영됨(PUT 2xx) — " : ""}실행기 예외: ${e.message.slice(0, 200)}` };
  }
}

async function loop(ctx, once) {
  for (;;) {
    if (stopping) { await ctx.close().catch(() => {}); process.exit(0); }
    let page, loggedIn;
    try { ({ page, loggedIn } = await ensureClaudePage(ctx)); }
    catch (e) { log({ page_error: e.message }); await heartbeat(false, `페이지 오류: ${e.message.slice(0, 120)}`); if (once) return; await sleep(POLL_MS); continue; }
    if (!loggedIn) { log({ logged_in: false }); await heartbeat(false, "로그인 필요 — claude-seat-login.sh 실행"); if (once) return; await sleep(POLL_MS); continue; }
    await heartbeat(true, null);
    let claimed;
    try { claimed = await api("GET", `${API}?claim=1&executor=${encodeURIComponent(HOST)}`); }
    catch (e) { log({ claim_error: e.message }); if (once) return; await sleep(POLL_MS); continue; }
    const row = claimed?.row;
    if (row) {
      busy = true;
      log({ claim: row.id, org: row.org_id, email: row.email, action: row.action, target: row.target_tier });
      const result = await process1(page, row);
      try { await patchWithRetry({ id: row.id, executor: HOST, ...result }); } catch (e) { log({ patch_error: e.message }); }
      log({ done: row.id, ...result });
      busy = false;
      if (stopping) { await ctx.close().catch(() => {}); process.exit(0); }
      if (once) return;
      continue; // 대기 요청이 더 있을 수 있으니 바로 다음 claim
    }
    if (once) return;
    await sleep(POLL_MS);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const login = process.argv.includes("--login");
  const once = process.argv.includes("--once");
  const ctx = await launch(login ? false : HEADLESS);
  if (login) {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://claude.ai/login", { waitUntil: "domcontentloaded" });
    console.log("브라우저에서 소유자 계정으로 로그인(Cloudflare 확인 포함)한 뒤 창을 닫으세요. 프로필:", PROFILE);
    // Chrome은 창을 다 닫아도 프로세스가 남아 close 이벤트가 안 올 수 있다 — 열린 탭이 0개가 되면 우리가 닫는다(쿠키 flush)
    await new Promise((r) => { ctx.on("close", r); const t = setInterval(() => { if (ctx.pages().length === 0) { clearInterval(t); r(); } }, 1000); });
    stopping = true;
    await ctx.close().catch(() => {});
    console.log("로그인 세션을 저장했습니다. 프로필:", PROFILE);
    return;
  }
  ctx.on("close", () => { if (stopping) return; log({ browser_closed: true }); process.exit(1); });
  log({ start: VERSION, host: HOST, app: APP_URL, headless: HEADLESS });
  const stop = async () => { log({ stop: true }); stopping = true; if (!busy) { await ctx.close().catch(() => {}); process.exit(0); } };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  await loop(ctx, once);
  stopping = true;
  await ctx.close().catch(() => {});
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } // symlink가 아직 없을 때 등의 폴백
}

if (isMainModule()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
