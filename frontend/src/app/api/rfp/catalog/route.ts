import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import type { RfpCatalogResponse } from "@/types/rfp";

export const runtime = "nodejs";

/** GET /api/rfp/catalog — 활성 솔루션, 기능은 비활성 포함(isActive로 구분). 콤보박스·요약 렌더용. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    const catalog = await loadCatalog(auth.admin, { activeSolutionsOnly: true });
    const res: RfpCatalogResponse = {
      solutions: catalog.map((s) => ({
        code: s.code, name: s.name, description: s.description, isActive: s.isActive,
        features: s.features.map((f) => ({ id: f.id, name: f.name, description: f.description, evidenceUrl: f.evidenceUrl, isActive: f.isActive })),
      })),
    };
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "카탈로그를 불러오지 못했습니다." }, { status: 500 });
  }
}
