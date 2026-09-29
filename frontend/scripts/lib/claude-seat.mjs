// frontend/scripts/lib/claude-seat.mjs
// 시트 실행기의 순수 부분 — 브라우저·네트워크 없음(vitest가 직접 import해 TS와 대조한다)
import fs from "node:fs";

/** DB 표기 → claude.ai API 값. src/lib/claude-usage/seat-tier.ts의 TIER_TO_API와 같아야 한다 */
export const TIER_TO_API = { Standard: "team_standard", Premium: "team_tier_1", Unassigned: "unassigned" };

/** GET /api/organizations/<org>/members 응답(배열 또는 {members}|{data})에서 이메일로 멤버를 찾는다 */
export function findMember(payload, email) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.members) ? payload.members : Array.isArray(payload?.data) ? payload.data : [];
  const want = String(email ?? "").trim().toLowerCase();
  for (const m of list) {
    const a = m?.account ?? m;
    const got = String(a?.email_address ?? a?.email ?? "").trim().toLowerCase();
    if (got && got === want) return { uuid: String(a?.uuid ?? m?.uuid ?? m?.id ?? ""), seat_tier: String(m?.seat_tier ?? "") || "unassigned", role: String(m?.role ?? "") };
  }
  return null;
}

/** KEY=value 줄만 읽는다(따옴표 제거, # 주석·빈 줄·잘못된 줄 무시) */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return out;
}

/** 환경변수 → 파일 순서로 토큰을 찾는다 */
export function readToken(paths, env = process.env) {
  if (env.CLAUDE_OTEL_INGEST_TOKEN) return env.CLAUDE_OTEL_INGEST_TOKEN.trim();
  for (const p of paths) {
    try {
      const v = parseEnv(fs.readFileSync(p, "utf8")).CLAUDE_OTEL_INGEST_TOKEN;
      if (v) return v;
    } catch { /* 다음 후보 */ }
  }
  return null;
}
