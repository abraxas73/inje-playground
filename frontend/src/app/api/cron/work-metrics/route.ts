import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, isYmd, requireAdmin } from "@/lib/claude-usage/require-admin";
import { kstYesterday, logSync, type CollectResult } from "@/lib/work-metrics/common";
import { collectJira } from "@/lib/work-metrics/jira";
import { collectConfluence } from "@/lib/work-metrics/confluence";
import { collectGitlab } from "@/lib/work-metrics/gitlab";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/work-metrics?source=all|jira|confluence|gitlab&from&to
 * Jira/Confluence/GitLab 일 집계 수집. 기본 범위 = KST 어제 하루.
 * 인증: Vercel Cron(Authorization: Bearer CRON_SECRET) 또는 관리자 세션(수동 백필용).
 * 백필: ?from=2026-05-01&to=2026-08-30 (관리자 세션으로 호출; 소스당 몇 분 걸릴 수 있음)
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || bearer !== secret) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const source = sp.get("source") ?? "all";
  const yday = kstYesterday();
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : yday;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : yday;
  if (from > to) return NextResponse.json({ error: "from > to" }, { status: 400 });

  const collectors: Record<string, (a: typeof admin, f: string, t: string) => Promise<CollectResult>> = {
    jira: collectJira,
    confluence: collectConfluence,
    gitlab: collectGitlab,
  };
  const targets = source === "all" ? Object.keys(collectors) : collectors[source] ? [source] : [];
  if (targets.length === 0) return NextResponse.json({ error: `알 수 없는 source: ${source}` }, { status: 400 });

  const results: (CollectResult & { ok: boolean; error?: string })[] = [];
  for (const t of targets) {
    try {
      const r = await collectors[t](admin, from, to);
      results.push({ ...r, ok: true });
      if (!r.notes?.startsWith("미설정")) await logSync(admin, t, from, to, r.rows, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[work-metrics] ${t} 수집 실패: ${msg}`);
      results.push({ source: t, rows: 0, ok: false, error: msg.slice(0, 300) });
      await logSync(admin, t, from, to, 0, false, msg);
    }
  }
  return NextResponse.json({ range: { from, to }, results });
}
