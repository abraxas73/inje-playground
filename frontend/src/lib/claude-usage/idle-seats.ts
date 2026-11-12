// frontend/src/lib/claude-usage/idle-seats.ts
import { hasSeat } from "@/lib/claude-usage/aggregate";

/**
 * 매일 아침 자동 시트 해제 대상 — 최근 7일(CSV 기간 끝 날짜 포함) Claude(채팅·Cowork·Code) 사용이 0인 시트 보유자.
 * 근거: CSV(claude_member_activity)의 last_active + Claude Code 텔레메트리(claude_code_daily). 둘 중 하나라도 7일 안 활동이면 제외.
 * 새로 들어온 사람(7일 전 CSV에 없던 사람)·최근 7일 안에 시트를 할당받은 사람·조직 소유자는 건드리지 않는다.
 */

export const IDLE_DAYS = 7;
export const AUTO_REQUESTER = { id: "00000000-0000-0000-0000-000000000000", email: "자동 해제(7일 미사용)" };

const OWNER_ROLES = new Set(["owner", "primary owner"]);

/** YYYY-MM-DD에서 n일 뺀 날짜(UTC 달력) */
export function minusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export interface IdleInput {
  periodEnd: string; // CSV 기간 끝 날짜(UTC 어제)
  members: { email: string; role: string | null; seat_tier: string | null }[]; // 활성 멤버
  lastActive: Map<string, string | null>; // 최신 CSV의 email → last_active
  tenured: Set<string>; // 7일 전 이전 CSV에도 있던 email
  codeActive: Set<string>; // 7일 안 Claude Code 활동 email
  recentlyAssigned: Set<string>; // 7일 안 시트 할당 완료 email
}

export function pickIdleSeats(x: IdleInput): string[] {
  const since = minusDays(x.periodEnd, IDLE_DAYS - 1);
  return x.members
    .filter((m) => hasSeat(m.seat_tier) && !OWNER_ROLES.has((m.role ?? "").trim().toLowerCase()))
    .filter((m) => x.lastActive.has(m.email) && (x.lastActive.get(m.email) ?? "") < since)
    .filter((m) => x.tenured.has(m.email) && !x.codeActive.has(m.email) && !x.recentlyAssigned.has(m.email))
    .map((m) => m.email);
}
