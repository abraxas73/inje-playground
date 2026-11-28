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
  if (env.OPS_INGEST_TOKEN) return env.OPS_INGEST_TOKEN.trim();
  for (const p of paths) {
    try {
      const v = parseEnv(fs.readFileSync(p, "utf8")).OPS_INGEST_TOKEN;
      if (v) return v;
    } catch { /* 다음 후보 */ }
  }
  return null;
}

/** 자동 해제 요청자 표시 — src/lib/claude-usage/idle-seats.ts의 AUTO_REQUESTER.email과 같아야 한다 */
export const AUTO_RELEASE_REQUESTER = "자동 해제(7일 미사용)";
const ACTIVITY_COUNTS = ["chat_count", "message_count", "code_session_count", "cowork_session_count", "cowork_message_count", "pull_request_count", "file_edit_count"];

/**
 * claude.ai /analytics/activity/users 한 페이지({members:[…]})에서 그 사람이 since(YYYY-MM-DD) 이후 활동했는지.
 * 없으면 null, 있으면 근거 문자열. 이 목록은 기간 안 활동자만 나오므로 목록에 있으면 활동으로 본다(last_active·횟수는 근거 표시용).
 */
export function activitySince(payload, email, since) {
  const want = String(email ?? "").trim().toLowerCase();
  const m = (Array.isArray(payload?.members) ? payload.members : []).find((x) => String(x?.email ?? "").trim().toLowerCase() === want);
  if (!m) return null;
  const last = typeof m.last_active === "string" ? m.last_active : "";
  const used = ACTIVITY_COUNTS.some((k) => Number(m[k]) > 0);
  if (last && last < since && !used) return null;
  return `마지막 활동 ${last || "?"}`;
}
