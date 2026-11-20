#!/usr/bin/env node
// frontend/scripts/claude-invoice-sync.mjs
// Claude Team 인보이스 자동 등록 — 운영자 Mac에서 매일(launchd com.innogrid.claude-invoice-sync).
//   node scripts/claude-invoice-sync.mjs           # 결제 화면 목록을 읽어 새 인보이스만 서버에 등록
//   node scripts/claude-invoice-sync.mjs --dry     # 서버에 보내지 않고 목록만 출력(링크는 찍지 않음)
// 결제 화면은 조직 소유자(결제 권한)만 열린다 — 시트 실행기 계정(기본 프로필)은 권한이 없어, 소유자 계정을 로그인해 둔
// ego 프로필 "Profile 2"의 작업 공간 claude-billing을 쓴다(2026-11-20). 세션이 끊기면 그 공간에서 다시 로그인.
// claude.ai 내부 API: GET /api/organizations(조직), GET /api/stripe/<org>/invoices?limit=12&page=(최근 12건, hosted_invoice_url)
// 서버 계약: POST /api/admin/claude-cost/invoices/sync { items:[{org_id, invoice_number, url}] } (Bearer OPS_INGEST_TOKEN)
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readToken } from "./lib/claude-seat.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = (process.env.APP_URL || "https://innocrew.innogrid.com").replace(/\/$/, "");
const SPACE = process.env.BILLING_EGO_SPACE || "claude-billing";
const PROFILE = process.env.BILLING_EGO_PROFILE || "Profile 2";
const ORG_NAME_RE = /^Innogrid/; // 같은 계정의 다른 회사 조직(계약 결제 등)은 제외
const MARKER = "INVOICE_SYNC_RESULT=";
const dry = process.argv.includes("--dry");
const log = (obj) => console.log(JSON.stringify({ t: new Date().toISOString(), ...obj }));

const code = `
const existing = (await listTaskSpaces()).find(s => s.name === ${JSON.stringify(SPACE)});
if (existing && existing.ownership !== "agent") throw new Error("작업 공간을 사용자가 쓰는 중");
const task = existing ? await taskSpace(${JSON.stringify(SPACE)}) : await taskSpace(${JSON.stringify(SPACE)}, { profileId: ${JSON.stringify(PROFILE)} }); // profileId는 새로 만들 때만 받는다
const page = task.page("p1");
let origin = null;
try { origin = new URL(await page.url()).origin; } catch {}
if (origin !== "https://claude.ai") await page.goto("https://claude.ai/new");
const r = await page.fetch("/api/organizations", { timeout: 20000 });
if (r.status !== 200) { console.log(${JSON.stringify(MARKER)} + JSON.stringify({ login: false, status: r.status })); process.exit(0); }
const orgs = JSON.parse(r.body).filter(o => String(o.billing_type || "").startsWith("stripe_subscription") && ${ORG_NAME_RE}.test(o.name));
const items = [], errors = [];
for (const o of orgs) {
  const res = await page.fetch("/api/stripe/" + o.uuid + "/invoices?limit=12&page=", { timeout: 20000 });
  if (res.status !== 200) { errors.push({ org: o.name, status: res.status }); continue; }
  for (const i of JSON.parse(res.body).invoices || []) {
    if (i.status === "paid" && i.invoice_number && i.hosted_invoice_url) items.push({ org_id: o.uuid, org: o.name, invoice_number: i.invoice_number, url: i.hosted_invoice_url, created: i.created_ts });
  }
}
console.log(${JSON.stringify(MARKER)} + JSON.stringify({ login: true, orgs: orgs.length, items, errors }));
`;

function ego() {
  return new Promise((resolve, reject) => {
    const child = execFile("ego-browser", ["nodejs", "-e", code], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const line = `${stdout}\n${stderr}`.split("\n").find((l) => l.startsWith(MARKER));
      if (line) resolve(JSON.parse(line.slice(MARKER.length)));
      else reject(new Error(error ? `ego 실행 실패: ${String(stderr).split("\n").find((l) => /Error/.test(l))?.slice(0, 200) ?? ""}` : "ego 응답 없음")); // 오류 원문에 명령·링크가 들어 있어 내보내지 않는다
    });
    child.stdin.end();
  });
}

const got = await ego();
if (!got.login) {
  log({ error: "claude.ai 로그인 필요", status: got.status, space: SPACE, profile: PROFILE });
  process.exit(2);
}
log({ orgs: got.orgs, invoices: got.items.length, list_errors: got.errors });
if (dry) {
  for (const i of got.items) log({ org: i.org, invoice_number: i.invoice_number, created: new Date(i.created * 1000).toISOString().slice(0, 10) });
  process.exit(0);
}
if (got.items.length === 0) process.exit(got.errors.length ? 1 : 0);

const token = readToken([path.join(HERE, "..", ".env.local"), path.join(os.homedir(), ".config", "inje-playground", "work-metrics.env")]);
if (!token) { console.error("OPS_INGEST_TOKEN이 없습니다(env 또는 frontend/.env.local)"); process.exit(1); }
const res = await fetch(`${APP_URL}/api/admin/claude-cost/invoices/sync`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ items: got.items.map(({ org_id, invoice_number, url }) => ({ org_id, invoice_number, url })) }),
  signal: AbortSignal.timeout(290_000),
});
const body = await res.json().catch(() => null);
if (!res.ok) { log({ error: `sync ${res.status}`, detail: body?.error }); process.exit(1); }
const results = body.results ?? [];
for (const r of results.filter((x) => x.status !== "exists")) log(r);
const failed = results.filter((x) => x.status === "failed").length;
log({ added: results.filter((x) => x.status === "added").length, exists: results.filter((x) => x.status === "exists").length, failed });
process.exit(failed || got.errors.length ? 1 : 0);
