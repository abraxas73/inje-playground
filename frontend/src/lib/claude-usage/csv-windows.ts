import type { MemberActivityRow } from "@/types/claude-usage";

/**
 * 멤버 활동 CSV(30일 롤링 합계 스냅샷)를 여러 창으로 이어 붙여 60·90일 합계를 만든다.
 * 일별 값이 없으므로 종료일에서 30일씩 거슬러 간 목표일마다 조직별로 가장 가까운(±3일) 수집을 고르고, 창끼리는 겹치지 않는다.
 */

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY;

/** 종료일, 30일 전, 60일 전 … (창 개수만큼) */
export function windowTargets(end: string, windows: number): string[] {
  const base = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: Math.max(1, windows) }, (_, k) => ymd(base - 30 * k * DAY));
}

export interface WindowPick<T> { target: string; imports: T[] }

/**
 * 창마다 조직별 수집 1건. imports는 period_end desc, created_at desc 정렬(같은 period_end면 먼저 온 것이 최신 업로드).
 * 목표일과 3일 넘게 차이 나면 그 조직은 그 창에 없다(미수집).
 */
export function pickWindowImports<T extends { org_id: string; period_end: string }>(imports: T[], end: string, windows: number, tolerance = 3): WindowPick<T>[] {
  return windowTargets(end, windows).map((target) => {
    const best = new Map<string, { imp: T; dist: number }>();
    for (const i of imports) {
      const dist = days(i.period_end, target);
      if (dist > tolerance) continue;
      const cur = best.get(i.org_id);
      if (!cur || dist < cur.dist) best.set(i.org_id, { imp: i, dist }); // 같은 거리면 먼저 온 것(최신 업로드) 유지
    }
    return { target, imports: [...best.values()].map((b) => b.imp) };
  });
}

type Row = MemberActivityRow & { org_id: string; import_id: string };
const SUM_KEYS = ["days_active", "chats", "messages", "projects_created", "projects_used", "pull_requests", "code_sessions", "file_edits", "cowork_sessions", "cowork_messages", "unified_messages", "artifacts_created", "claude_code_artifacts", "cowork_artifacts", "estimated_spend_usd"] as const;

/** 창별 행 목록(0번이 최신 창)을 조직·이메일로 합친다. 숫자는 합, 이름·역할·티어·import_id는 최신 창, last_active는 최댓값 */
export function mergeWindowRows<T extends Row>(rowsByWindow: T[][]): T[] {
  if (rowsByWindow.length <= 1) return rowsByWindow[0] ?? [];
  const out = new Map<string, T>();
  rowsByWindow.forEach((rows, w) => {
    for (const r of rows) {
      const key = `${r.org_id}|${r.email.toLowerCase()}`;
      const prev = out.get(key);
      if (!prev) { out.set(key, { ...r }); continue; }
      const merged: T = w === 0 ? { ...prev, ...r } : { ...prev };
      for (const k of SUM_KEYS) (merged as Record<string, unknown>)[k] = Number(prev[k] ?? 0) + Number(r[k] ?? 0);
      merged.last_active = [prev.last_active, r.last_active].filter((v): v is string => !!v).sort().at(-1) ?? null;
      out.set(key, merged);
    }
  });
  return [...out.values()];
}
