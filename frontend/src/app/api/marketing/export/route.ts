import { NextRequest, NextResponse } from "next/server";
import { masterExport } from "@/lib/marketing/excel";
import { masterFilters } from "@/lib/marketing/search";
import { dbCheck, failure, marketingAuth, MarketingError } from "@/lib/marketing/server";
import type { Contact } from "@/lib/marketing/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const { db } = await marketingAuth();
    const filters = masterFilters(req.nextUrl.searchParams);
    // One database snapshot; no UI pagination or client-side reimplementation of filters.
    const result = await db.rpc("marketing_search_contacts", { ...filters, p_offset: 0, p_limit: null });
    dbCheck(result.error);
    const data = result.data as { rows: Contact[]; total: number };
    if (!Array.isArray(data?.rows) || data.rows.length !== data.total) throw new MarketingError("전체 결과를 조회하지 못했습니다. 다시 다운로드해 주세요.", 503);
    const generatedAt = new Date();
    const buffer = await masterExport(data.rows, filters, generatedAt);
    const stamp = generatedAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    return new NextResponse(new Uint8Array(buffer), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Master-DB-${stamp}.xlsx"`,
      "Cache-Control": "private, no-store",
      "X-Export-Count": String(data.total),
    } });
  } catch (e) { return failure(e); }
}
