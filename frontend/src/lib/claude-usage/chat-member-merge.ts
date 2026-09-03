/**
 * 채팅·Cowork(CSV) 멤버 행을 이메일 단위로 합친다 — 개인 화면(/usage/chat)용.
 * 같은 사람이 여러 Claude 조직에 있으면(소유자 계정 등) CSV 행이 조직마다 오므로
 * 활동 수치는 더하고, 활동일·마지막 활동은 최댓값, 시트는 배정된 쪽을 남긴다.
 * Claude Code 프롬프트(code_prompts)는 이메일 기준으로 이미 합산된 값이라 더하지 않고 최댓값을 쓴다.
 */
import { hasSeat } from "./aggregate";

export const MEMBER_SUM_FIELDS = [
  "chats",
  "messages",
  "code_sessions",
  "pull_requests",
  "cowork_sessions",
  "cowork_messages",
  "projects_used",
  "artifacts_created",
  "estimated_spend_usd",
] as const;
export type MemberSumField = (typeof MEMBER_SUM_FIELDS)[number];

export type MergeableMemberRow = Record<MemberSumField, number> & {
  email: string;
  seat_tier?: string | null;
  last_active: string | null;
  days_active: number;
  code_prompts?: number;
  code_prompts_auto?: number;
};

export function mergeMembersByEmail<T extends MergeableMemberRow>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    const k = r.email.toLowerCase();
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...r });
      continue;
    }
    for (const f of MEMBER_SUM_FIELDS) prev[f] = ((Number(prev[f]) || 0) + (Number(r[f]) || 0)) as T[typeof f];
    prev.days_active = Math.max(prev.days_active, r.days_active);
    prev.last_active = [prev.last_active, r.last_active].filter((v): v is string => !!v).sort().at(-1) ?? null;
    if (!hasSeat(prev.seat_tier) && hasSeat(r.seat_tier)) prev.seat_tier = r.seat_tier;
    prev.code_prompts = Math.max(prev.code_prompts ?? 0, r.code_prompts ?? 0);
    prev.code_prompts_auto = Math.max(prev.code_prompts_auto ?? 0, r.code_prompts_auto ?? 0);
  }
  return [...map.values()];
}
