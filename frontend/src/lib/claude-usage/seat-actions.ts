// frontend/src/lib/claude-usage/seat-actions.ts
import { hasSeat } from "@/lib/claude-usage/aggregate";
import { normalizeTier } from "@/lib/claude-usage/seat-tier";
import type { SeatAction, SeatActionInput, SeatActionStatus, SeatActionSummary, SeatExecutor } from "@/types/claude-seat";

/**
 * 시트 할당·해제 요청의 검증·상태 규칙·표 요약 — 라우트와 화면이 같이 쓰는 순수 함수.
 * 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md §4·§5·§7
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRequest(body: unknown): { ok: true; value: SeatActionInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const org_id = typeof b.org_id === "string" ? b.org_id.trim().toLowerCase() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!org_id || !EMAIL_RE.test(email)) return { ok: false, error: "org_id와 이메일이 필요합니다." };
  if (b.action !== "unassign" && b.action !== "assign") return { ok: false, error: "action은 unassign 또는 assign이어야 합니다." };
  if (b.action === "assign") {
    if (b.target_tier !== "Standard" && b.target_tier !== "Premium") return { ok: false, error: "할당 티어(Standard 또는 Premium)를 고르세요." };
    return { ok: true, value: { org_id, email, action: "assign", target_tier: b.target_tier } };
  }
  return { ok: true, value: { org_id, email, action: "unassign", target_tier: null } };
}

/** 현재 멤버 상태에 비춰 요청이 말이 되는지. 문제면 {status, error}, 괜찮으면 null */
export function checkRequest(input: SeatActionInput, member: { status: string; seat_tier: string | null } | null, hasOpen: boolean): { status: number; error: string } | null {
  if (!member || member.status !== "active") return { status: 404, error: "이 조직의 활성 멤버가 아닙니다." };
  if (hasOpen) return { status: 409, error: "이미 대기·실행 중인 요청이 있습니다." };
  const tier = normalizeTier(member.seat_tier);
  if (input.action === "unassign" && !hasSeat(tier)) return { status: 400, error: "이미 미할당입니다." };
  if (input.action === "assign" && hasSeat(tier)) return { status: 400, error: `이미 시트가 있습니다(${tier}).` };
  return null;
}

const TRANSITIONS: Record<SeatActionStatus, SeatActionStatus[]> = {
  requested: ["running", "cancelled"],
  running: ["done", "failed"],
  done: [], failed: [], cancelled: [],
};
export function canTransition(from: SeatActionStatus, to: SeatActionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

const OPEN = new Set<SeatActionStatus>(["requested", "running"]);
const DAY_MS = 86_400_000;

/** 조직|이메일 → 표에 보일 요약. 대기·실행 중이 우선, 없으면 24시간 안의 마지막 1건 */
export function summarize(actions: SeatAction[], now: Date): Map<string, SeatActionSummary> {
  const out = new Map<string, SeatActionSummary>();
  const cutoff = now.getTime() - DAY_MS;
  const sorted = [...actions].sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1)); // 최신 먼저
  for (const a of sorted) {
    const key = `${a.org_id}|${a.email}`;
    const prev = out.get(key);
    if (prev && OPEN.has(prev.status)) continue;
    if (!OPEN.has(a.status) && (prev || Date.parse(a.requested_at) < cutoff)) continue;
    out.set(key, { id: a.id, action: a.action, status: a.status, target_tier: a.target_tier, requested_at: a.requested_at, error: a.error });
  }
  return out;
}

/** 실행기 칩 문구. 60초 넘게 하트비트가 없으면 꺼짐, 세션 없으면 로그인 필요 */
export function executorState(ex: SeatExecutor | null, now: Date): { level: "ok" | "off" | "login"; text: string } {
  if (!ex) return { level: "off", text: "실행기 기록 없음 — 관리자 Mac에서 claude-seat-executor를 켜야 합니다" };
  const sec = Math.max(0, Math.round((now.getTime() - Date.parse(ex.last_seen_at)) / 1000));
  if (sec > 60) {
    const ago = sec < 3600 ? `${Math.round(sec / 60)}분 전` : sec < DAY_MS / 1000 ? `${Math.round(sec / 3600)}시간 전` : `${Math.round(sec / 86400)}일 전`;
    return { level: "off", text: `실행기 꺼짐(마지막 ${ago}) — 요청은 켜지면 처리됩니다` };
  }
  if (!ex.logged_in) return { level: "login", text: "claude.ai 로그인 필요 — 관리자 Mac에서 claude-seat-login.sh 실행" };
  return { level: "ok", text: sec < 20 ? "실행기 정상 · 방금" : `실행기 정상 · ${sec}초 전` };
}

/** 멤버 표 행에 claude_org_members 티어(있으면)와 요청 요약을 붙인다 */
export function overlaySeat<T extends { org_id: string; email: string; seat_tier: string }>(
  rows: T[],
  orgMembers: { org_id: string; email: string; seat_tier: string | null }[],
  summaries: Map<string, SeatActionSummary>,
): (T & { seat_action: SeatActionSummary | null })[] {
  const tier = new Map<string, string>();
  for (const m of orgMembers) if (m.seat_tier) tier.set(`${m.org_id}|${m.email.toLowerCase()}`, normalizeTier(m.seat_tier));
  return rows.map((r) => {
    const key = `${r.org_id}|${r.email.toLowerCase()}`;
    const t = tier.get(key);
    return { ...r, seat_tier: t ?? r.seat_tier, seat_action: summaries.get(key) ?? null };
  });
}
