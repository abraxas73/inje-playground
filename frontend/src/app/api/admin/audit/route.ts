import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { kstRange, pageRange, parseAuditQuery, searchOrFilter } from "@/lib/audit-query";
import type { AuditResponse, AuditRow } from "@/types/audit";

export const runtime = "nodejs";

interface AuditDbRow {
  id: string;
  kind: AuditRow["kind"];
  at: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  category: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
}

const SELECT = "id, kind, at, user_id, user_email, user_name, category, action, detail, ip_address, user_agent";

/**
 * GET /api/admin/audit?kind=all|login|action|api&category=&q=&from=&to=&page=&pageSize=
 * 로그인 이력 + 액션 이력 통합 조회(admin). 뷰 `audit_log`는 service_role만 읽는다.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const client = adminClientOr500();
  if (!client.ok) return client.response;

  const query = parseAuditQuery(request.nextUrl.searchParams);
  const { gte, lte } = kstRange(query.from, query.to);
  const { start, end } = pageRange(query.page, query.pageSize);

  let q = client.admin.from("audit_log").select(SELECT, { count: "exact" }).order("at", { ascending: false });
  if (query.kind !== "all") q = q.eq("kind", query.kind);
  if (query.category) q = q.eq("category", query.category);
  if (gte) q = q.gte("at", gte);
  if (lte) q = q.lte("at", lte);
  const or = searchOrFilter(query.q);
  if (or) q = q.or(or);

  const { data, error, count } = await q.range(start, end);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 카테고리 선택지 — 조회 조건과 무관하게 현재 데이터에 있는 값(최근 5000건 기준)
  const { data: cats } = await client.admin.from("audit_log").select("category").order("at", { ascending: false }).limit(5000);
  const categories = [...new Set((cats ?? []).map((c) => (c as { category: string | null }).category).filter((c): c is string => !!c))].sort();

  const rows: AuditRow[] = ((data ?? []) as AuditDbRow[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    at: r.at,
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name,
    category: r.category ?? "",
    action: r.action,
    detail: r.detail ?? {},
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
  }));

  const body: AuditResponse = { rows, total: count ?? rows.length, page: query.page, pageSize: query.pageSize, categories };
  return NextResponse.json(body);
}
