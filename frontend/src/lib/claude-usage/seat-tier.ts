import type { SeatTier } from "@/types/claude-seat";

/**
 * 시트 티어 표기 — DB·화면은 Standard/Premium/Unassigned, claude.ai 내부 API는 team_standard/team_tier_1/unassigned.
 * 실행기(scripts/lib/claude-seat.mjs)가 같은 표를 갖는다 — 바꾸면 둘 다 바꾼다(테스트가 대조).
 */
export const TIER_TO_API: Record<SeatTier, "team_standard" | "team_tier_1" | "unassigned"> = {
  Standard: "team_standard",
  Premium: "team_tier_1",
  Unassigned: "unassigned",
};

const CANON: Record<string, SeatTier> = {
  team_standard: "Standard", standard: "Standard", "스탠다드": "Standard",
  team_tier_1: "Premium", premium: "Premium", "프리미엄": "Premium",
  unassigned: "Unassigned", none: "Unassigned", "": "Unassigned", "할당되지 않음": "Unassigned",
};

/** API 값·화면 표기·한글 어느 쪽이 와도 표준 표기로. 모르는 값은 첫 글자만 대문자 */
export function normalizeTier(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const c = CANON[s.toLowerCase()];
  return c ?? s.charAt(0).toUpperCase() + s.slice(1);
}
