import { NextRequest, NextResponse } from "next/server";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { upsertChunked, logSync } from "@/lib/work-metrics/common";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/work-metrics/sync — 성과 지표 로컬 푸시(사내망 전용 시스템용 폴백).
 * Vercel에서 접근할 수 없는 GitLab(사내 IP 화이트리스트) 등의 일 집계를 로컬 스크립트가 계산해 밀어 넣는다.
 * 인증: Bearer CLAUDE_OTEL_INGEST_TOKEN(수집 토큰) 또는 관리자 세션.
 * body: { source: "gitlab"|"jira"|"confluence", rows: [...] } — 소스별 허용 컬럼만 통과, PK upsert(교체).
 */

const TABLES: Record<string, { table: string; conflict: string; columns: string[] }> = {
  gitlab: { table: "gitlab_daily", conflict: "day,user_email,project_path", columns: ["day", "user_email", "project_path", "commits", "mrs_opened", "mrs_merged", "mr_lead_hours_sum"] },
  jira: { table: "jira_issue_daily", conflict: "day,user_email,project_key", columns: ["day", "user_email", "project_key", "issues_created", "issues_resolved", "lead_hours_sum", "cycle_hours_sum", "cycle_count", "story_points"] },
  confluence: { table: "confluence_daily", conflict: "day,user_email,space_key", columns: ["day", "user_email", "space_key", "pages_created", "pages_updated"] },
};

export async function POST(request: NextRequest) {
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const body = (await request.json().catch(() => null)) as { source?: string; rows?: Record<string, unknown>[] } | null;
  const spec = body?.source ? TABLES[body.source] : undefined;
  if (!spec || !Array.isArray(body?.rows)) return NextResponse.json({ error: "source/rows가 필요합니다." }, { status: 400 });
  if (body.rows.length > 20000) return NextResponse.json({ error: "rows는 20,000행 이하로 나눠 보내세요." }, { status: 400 });

  const rows = body.rows
    .map((r) => Object.fromEntries(spec.columns.map((col) => [col, r[col]])))
    .filter((r) => typeof r.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.day as string) && typeof r.user_email === "string" && (r.user_email as string).length > 3);
  if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0, skipped: body.rows.length });

  try {
    await upsertChunked(admin, spec.table, rows, spec.conflict);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(admin, body.source!, String(rows[0].day), String(rows[rows.length - 1].day), 0, false, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  const days = rows.map((r) => r.day as string).sort();
  await logSync(admin, body.source!, days[0], days[days.length - 1], rows.length, true, "push");
  return NextResponse.json({ ok: true, upserted: rows.length, skipped: body.rows.length - rows.length });
}
