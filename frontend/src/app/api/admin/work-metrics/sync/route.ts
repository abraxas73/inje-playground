import { NextRequest, NextResponse } from "next/server";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { upsertChunked, logSync, deleteDayRange } from "@/lib/work-metrics/common";
import { loadEmailResolver, resolveAndMergeGitlabRows, resolveCommitterEmail } from "@/lib/work-metrics/email-resolve";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/work-metrics/sync — 성과 지표 로컬 푸시(사내망 전용 시스템용 폴백).
 * Vercel에서 접근할 수 없는 GitLab(사내 IP 화이트리스트) 등의 일 집계를 로컬 스크립트가 계산해 밀어 넣는다.
 * 인증: Bearer CLAUDE_OTEL_INGEST_TOKEN(수집 토큰) 또는 관리자 세션.
 * body: { source: "gitlab"|"jira"|"confluence", rows: [...], replace?: { from, to } }
 *  - 소스별 허용 컬럼만 통과, PK upsert(교체).
 *  - replace가 있으면 그 기간(day 포함)의 기존 행을 먼저 지운다 — force-push로 사라진 커밋·이전 규칙으로 쌓인 행 정리.
 *    여러 청크로 나눠 보낼 때는 첫 청크에만 넣는다.
 *  - gitlab은 user_email을 회사 이메일로 정규화(lib/work-metrics/email-resolve.ts)하고 같은 사람으로 합쳐진 행을 더한다.
 */

const TABLES: Record<string, { table: string; conflict: string; columns: string[] }> = {
  gitlab: { table: "gitlab_daily", conflict: "day,user_email,project_path", columns: ["day", "user_email", "project_path", "commits", "claude_commits", "mrs_opened", "mrs_merged", "mr_lead_hours_sum"] },
  jira: { table: "jira_issue_daily", conflict: "day,user_email,project_key", columns: ["day", "user_email", "project_key", "issues_created", "issues_resolved", "lead_hours_sum", "cycle_hours_sum", "cycle_count", "story_points"] },
  confluence: { table: "confluence_daily", conflict: "day,user_email,space_key", columns: ["day", "user_email", "space_key", "pages_created", "pages_updated"] },
};

type Body = { source?: string; rows?: Record<string, unknown>[]; replace?: { from?: unknown; to?: unknown } };

export async function POST(request: NextRequest) {
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const body = (await request.json().catch(() => null)) as Body | null;
  const spec = body?.source ? TABLES[body.source] : undefined;
  if (!spec || !Array.isArray(body?.rows)) return NextResponse.json({ error: "source/rows가 필요합니다." }, { status: 400 });
  if (body.rows.length > 20000) return NextResponse.json({ error: "rows는 20,000행 이하로 나눠 보내세요." }, { status: 400 });
  const source = body.source!;

  let replace: { from: string; to: string } | null = null;
  if (body.replace) {
    const from = typeof body.replace.from === "string" ? body.replace.from : null;
    const to = typeof body.replace.to === "string" ? body.replace.to : null;
    if (!isYmd(from) || !isYmd(to) || from > to) return NextResponse.json({ error: "replace.from/to는 YYYY-MM-DD(from ≤ to)여야 합니다." }, { status: 400 });
    replace = { from, to };
  }

  let rows = body.rows
    .map((r) => Object.fromEntries(spec.columns.map((col) => [col, r[col]])))
    .filter((r) => typeof r.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.day as string) && typeof r.user_email === "string" && (r.user_email as string).length > 3)
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));

  try {
    if (source === "gitlab" && rows.length > 0) {
      const resolver = await loadEmailResolver(admin);
      rows = resolveAndMergeGitlabRows(rows as Array<{ day: string; user_email: string; project_path: string } & Record<string, unknown>>, (e) => resolveCommitterEmail(e, resolver));
    }
    if (replace) await deleteDayRange(admin, spec.table, replace.from, replace.to);
    if (rows.length > 0) await upsertChunked(admin, spec.table, rows, spec.conflict);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const first = rows[0]?.day ?? replace?.from ?? "1970-01-01";
    await logSync(admin, source, String(first), String(rows[rows.length - 1]?.day ?? replace?.to ?? first), 0, false, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0, skipped: body.rows.length, replaced: replace });
  const days = rows.map((r) => r.day as string).sort();
  await logSync(admin, source, replace?.from ?? days[0], replace?.to ?? days[days.length - 1], rows.length, true, replace ? "push(replace)" : "push");
  return NextResponse.json({ ok: true, upserted: rows.length, skipped: body.rows.length - rows.length, replaced: replace });
}
