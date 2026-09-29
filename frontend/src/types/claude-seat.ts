// frontend/src/types/claude-seat.ts
/** Claude 시트 할당·해제 — 요청·실행 이력(claude_seat_actions)과 실행기 하트비트(claude_seat_executor). 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md */

export type SeatActionKind = "unassign" | "assign";
export type SeatActionStatus = "requested" | "running" | "done" | "failed" | "cancelled";
/** DB·화면 표기. claude.ai API 값과의 대응은 lib/claude-usage/seat-tier.ts */
export type SeatTier = "Standard" | "Premium" | "Unassigned";

export interface SeatAction {
  id: string;
  org_id: string;
  email: string;
  action: SeatActionKind;
  target_tier: "Standard" | "Premium" | null;
  status: SeatActionStatus;
  requested_by: string;
  requested_by_email: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  before_tier: string | null;
  after_tier: string | null;
  error: string | null;
  executor: string | null;
}

export interface SeatExecutor {
  id: string;
  last_seen_at: string;
  logged_in: boolean;
  note: string | null;
  host: string | null;
  version: string | null;
}

/** 멤버 표 행에 붙는 요약 — 대기·실행 중이면 그것, 아니면 최근 24시간 마지막 1건 */
export interface SeatActionSummary {
  id: string;
  action: SeatActionKind;
  status: SeatActionStatus;
  target_tier: "Standard" | "Premium" | null;
  requested_at: string;
  error: string | null;
}

/** POST 요청 본문(검증 후) */
export interface SeatActionInput {
  org_id: string;
  email: string;
  action: SeatActionKind;
  target_tier: "Standard" | "Premium" | null;
}
