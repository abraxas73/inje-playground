#!/usr/bin/env node
// frontend/scripts/claude-seat-executor.mjs
// Claude 시트 할당·해제 실행기 — 관리자 Mac에서 상시 실행(launchd com.innogrid.claude-seat-executor).
//   node scripts/claude-seat-executor.mjs            # 15초마다 대기 요청을 claim해 claude.ai에 반영
//   node scripts/claude-seat-executor.mjs --check    # 읽기 전용 ego 연결/소유자 권한 점검
//   node scripts/claude-seat-executor.mjs --once     # 한 행만 처리하고 종료(점검용)
// 환경: CLAUDE_OTEL_INGEST_TOKEN(없으면 frontend/.env.local → ~/.config/inje-playground/work-metrics.env),
//       APP_URL(기본 프로덕션), SEAT_EGO_SPACE_ID(기존 ego 전용 워크스페이스 ID, 필수)
// 서버 계약: GET ?claim=1 → {row}, PATCH {id,status,before_tier,after_tier,error,executor}, PUT heartbeat — src/app/api/admin/claude-usage/seat-actions
// 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md §6
import { egoRequest } from "./lib/claude-seat-ego.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TIER_TO_API, findMember, readToken } from "./lib/claude-seat.mjs";

const VERSION = "2026-10-16.ego";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = (process.env.APP_URL || "https://inje-playground.vercel.app").replace(/\/$/, "");
const SPACE_ID = Number(process.env.SEAT_EGO_SPACE_ID);
const POLL_MS = 15_000;
const HOST = os.hostname();
const API = `${APP_URL}/api/admin/claude-usage/seat-actions`;
let busy = false;
let stopping = false;
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

const claudeFetch = (_page, url, init) => egoRequest(SPACE_ID, url, init);

async function ensureClaudePage() {
  // Check access before claiming work, so a non-owner session leaves requests queued.
  const r = await claudeFetch(null, "/api/organizations/4ad6b3e9-552f-4b67-bb96-25b51d1852f4/analytics/activity/overview");
  loginOk = r.status === 200 && r.json !== null;
  return { page: SPACE_ID, loggedIn: loginOk };
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

async function loop(once) {
  for (;;) {
    if (stopping) { process.exit(0); }
    let page, loggedIn;
    try { ({ page, loggedIn } = await ensureClaudePage()); }
    catch (e) { log({ page_error: e.message }); await heartbeat(false, `페이지 오류: ${e.message.slice(0, 120)}`); if (once) return; await sleep(POLL_MS); continue; }
    if (!loggedIn) { log({ logged_in: false }); await heartbeat(false, "ego 전용 공간에서 조직 소유자 로그인/권한 확인 필요"); if (once) return; await sleep(POLL_MS); continue; }
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
      if (stopping) { process.exit(0); }
      if (once) return;
      continue; // 대기 요청이 더 있을 수 있으니 바로 다음 claim
    }
    if (once) return;
    await sleep(POLL_MS);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (process.argv.includes("--login")) {
    console.log(`ego 전용 워크스페이스 ${SPACE_ID}의 Claude에 소유자 계정으로 로그인하세요. 공간과 탭은 닫지 마세요.`);
    return;
  }
  if (process.argv.includes("--check")) {
    const { loggedIn } = await ensureClaudePage();
    console.log(JSON.stringify({ spaceId: SPACE_ID, loggedIn, readOnly: true }));
    if (!loggedIn) process.exitCode = 2;
    return;
  }
  log({ start: VERSION, host: HOST, app: APP_URL, ego_space_id: SPACE_ID });
  const stop = () => { stopping = true; if (!busy) process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  await loop(process.argv.includes("--once"));
  // User requested a persistent workspace: leave it open between runs.
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } // symlink가 아직 없을 때 등의 폴백
}

if (isMainModule()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
