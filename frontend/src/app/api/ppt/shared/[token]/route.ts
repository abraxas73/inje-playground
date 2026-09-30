import { NextRequest, NextResponse } from "next/server";
import { resolveSharedDeck } from "@/lib/ppt/shared-access";
import type { PptSharedDeck } from "@/types/ppt";

export const runtime = "nodejs";
type Params = { params: Promise<{ token: string }> };

/** GET /api/ppt/shared/[token] — 로그인 사용자용 공유 뷰 데이터. 토큰은 응답·로그에 넣지 않는다. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { token } = await params;
  const r = await resolveSharedDeck(token);
  if (!r.ok) return r.response;
  if (!r.version.deck_json) return NextResponse.json({ error: "완료된 버전이 없습니다." }, { status: 404 });
  const res: PptSharedDeck = {
    title: r.deck.title || "제목 없음", ownerEmail: r.deck.owner_email, version: r.version.no, slideCount: r.version.slide_count,
    deckJson: r.version.deck_json, updatedAt: r.deck.updated_at,
  };
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
