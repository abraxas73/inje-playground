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

  // 진단: ?probe=1 — 각 시스템 인증·가시성 확인(수집 없음)
  if (sp.get("probe") === "1") {
    const out: Record<string, unknown> = {};
    const site = (process.env.ATLASSIAN_SITE ?? "").replace(/\/+$/, "");
    const basic = `Basic ${Buffer.from(`${process.env.ATLASSIAN_EMAIL}:${process.env.ATLASSIAN_API_TOKEN}`).toString("base64")}`;
    try {
      const me = await fetch(`${site}/rest/api/3/myself`, { headers: { Authorization: basic, Accept: "application/json" } });
      const meJ = me.ok ? ((await me.json()) as { displayName?: string; emailAddress?: string }) : null;
      const cnt = await fetch(`${site}/rest/api/3/search/approximate-count`, { method: "POST", headers: { Authorization: basic, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ jql: 'created >= "2026-08-01"' }) });
      const projects = await fetch(`${site}/rest/api/3/project/search?maxResults=10`, { headers: { Authorization: basic, Accept: "application/json" } });
      const projJ = projects.ok ? ((await projects.json()) as { total?: number; values?: { key: string }[] }) : null;
      out.jira = { myself: me.status, who: meJ?.displayName ?? null, approxCount: cnt.ok ? await cnt.json() : `HTTP ${cnt.status}: ${(await cnt.text()).slice(0, 150)}`, projects: projJ ? { total: projJ.total, keys: (projJ.values ?? []).map((p) => p.key) } : `HTTP ${projects.status}` };
      const wiki = await fetch(`${site}/wiki/rest/api/space?limit=5`, { headers: { Authorization: basic, Accept: "application/json" } });
      const wikiJ = wiki.ok ? ((await wiki.json()) as { results?: { key: string }[] }) : null;
      out.confluence = { spaces: wiki.status, keys: (wikiJ?.results ?? []).map((s) => s.key) };
    } catch (e) {
      out.atlassian_error = e instanceof Error ? e.message : String(e);
    }
    try {
      const gl = await fetch(`${(process.env.GITLAB_URL ?? "").replace(/\/+$/, "")}/api/v4/version`, { headers: { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN ?? "" }, signal: AbortSignal.timeout(8000) });
      out.gitlab = { status: gl.status, body: (await gl.text()).slice(0, 150) };
    } catch (e) {
      out.gitlab = { error: e instanceof Error ? `${e.name}: ${e.message} ${(e.cause as Error | undefined)?.message ?? ""}` : String(e) };
    }
    return NextResponse.json(out);
  }
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
