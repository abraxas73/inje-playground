import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertChunked } from "./common";

/**
 * work_items 항목 — 이슈·MR·커밋 한 행. 일 집계(jira_issue_daily·gitlab_daily)와 같은 수집에서 함께 쓴다.
 * 소요 시간·시간대는 이 테이블에서만 계산한다(SQL docs/sql/2026-09-28-work-items.sql).
 */

export type WorkItemKind = "issue" | "mr" | "commit";
export interface WorkItem {
  source: "jira" | "gitlab";
  kind: WorkItemKind;
  item_key: string;
  user_email: string;
  scope_key: string;
  created_at: string;
  started_at: string | null;
  done_at: string | null;
  story_points: number | null;
  is_claude: boolean;
}

/** 커밋 키 = 일 집계의 중복 제거 조합(이메일|authored 시각|제목)의 md5. 파이썬 스크립트(gitlab-metrics-sync.py)와 같아야 한다 */
export function commitItemKey(email: string, authoredIso: string, title: string): string {
  return createHash("md5").update(`${email}|${authoredIso}|${title}`).digest("hex");
}
export const mrItemKey = (projectPath: string, iid: number | string): string => `${projectPath}!${iid}`;

const toIso = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export function jiraIssueItem(i: { key: string; project: string; email: string; created: string; started: string | null; resolved: string; storyPoints: number | null }): WorkItem {
  return {
    source: "jira", kind: "issue", item_key: i.key, user_email: i.email, scope_key: i.project,
    created_at: new Date(i.created).toISOString(),
    started_at: i.started ? new Date(i.started).toISOString() : null,
    done_at: new Date(i.resolved).toISOString(),
    story_points: i.storyPoints, is_claude: false,
  };
}

/** sync API(gitlab_items)용 검증·정규화. 통과 못 하면 null — 그 행은 건너뛴다 */
export function normalizeGitlabItem(raw: unknown, resolveEmail: (email: string) => string): WorkItem | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== "mr" && kind !== "commit") return null;
  const key = typeof r.item_key === "string" ? r.item_key.trim() : "";
  if (!key || key.length > 200) return null;
  const email = typeof r.user_email === "string" ? r.user_email.trim().toLowerCase() : "";
  if (email.length < 4) return null;
  const scope = typeof r.scope_key === "string" ? r.scope_key.trim() : "";
  if (!scope) return null;
  const created = toIso(r.created_at);
  if (!created) return null;
  // 완료·시작이 생성보다 앞서면(시계 오차·수동 입력) 생성 시각으로 보정
  const notBefore = (v: unknown) => { const iso = toIso(v); return iso && iso < created ? created : iso; };
  return {
    source: "gitlab", kind, item_key: key, user_email: resolveEmail(email), scope_key: scope,
    created_at: created, started_at: notBefore(r.started_at), done_at: notBefore(r.done_at),
    story_points: null, is_claude: r.is_claude === true,
  };
}

/** PK(source·kind·item_key) 중복은 마지막 행만 남긴다 — 미러·체리픽 커밋은 키가 같아 한 배치에 두 번 오면 Postgres upsert가 "cannot affect row a second time"로 거부한다 */
export function dedupeItems(items: WorkItem[]): WorkItem[] {
  const byKey = new Map<string, WorkItem>();
  for (const it of items) byKey.set(`${it.source}|${it.kind}|${it.item_key}`, it);
  return [...byKey.values()];
}

export async function upsertItems(admin: SupabaseClient, items: WorkItem[]): Promise<number> {
  return upsertChunked(admin, "work_items", dedupeItems(items) as unknown as Record<string, unknown>[], "source,kind,item_key");
}
