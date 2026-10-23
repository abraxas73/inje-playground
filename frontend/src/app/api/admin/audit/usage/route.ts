import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, isYmd, requireAdmin } from "@/lib/claude-usage/require-admin";
import { kstRange } from "@/lib/audit-query";
import { summarizeFeatureUsage, type FeatureUsageRaw } from "@/lib/audit-usage";
import type { FeatureUsageResponse } from "@/types/audit";

export const runtime = "nodejs";

const kstDay = (offsetDays: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86400000));

/**
 * GET /api/admin/audit/usage?from=&to= — 기능별 사용 요약(admin, KST 날짜, 기본 최근 30일).
 * 집계는 DB 함수 audit_feature_usage(docs/sql/2026-10-23-audit-feature-usage.sql)가 한 번에 — select 1000행 상한을 피한다.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const client = adminClientOr500();
  if (!client.ok) return client.response;

  const sp = request.nextUrl.searchParams;
  const from = isYmd(sp.get("from")) ? sp.get("from")! : kstDay(-29);
  const to = isYmd(sp.get("to")) ? sp.get("to")! : kstDay(0);
  const { gte, lte } = kstRange(from, to);
  const { data, error } = await client.admin.rpc("audit_feature_usage", { p_from: gte, p_to: lte });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const body: FeatureUsageResponse = { from, to, ...summarizeFeatureUsage(data as FeatureUsageRaw | null) };
  return NextResponse.json(body);
}
