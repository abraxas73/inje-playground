import { NextRequest } from "next/server";
import { readPage } from "@/lib/confluence/client";
import { withConfluence } from "@/lib/confluence/route";
export const runtime = "nodejs";
/** GET /api/confluence/pages/{id} — 페이지 본문을 텍스트로(최대 2만 자) */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withConfluence((c) => readPage(c.request, id));
}
