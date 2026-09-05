import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { deleteConnection, getConnectionStatus } from "@/lib/ms/connections";

export const runtime = "nodejs";

/** GET /api/ms/connection — 내 Microsoft 계정 연결 상태(토큰 제외) */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await getConnectionStatus(auth.admin, auth.userId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "연결 상태를 불러오지 못했습니다." }, { status: 500 });
  }
}

/** DELETE /api/ms/connection — 연결 해제(행 삭제 + 토큰 캐시 제거). 프로젝트 폴더 설정·업로드 이력은 남는다. */
export async function DELETE() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    await deleteConnection(auth.admin, auth.userId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "연결을 해제하지 못했습니다." }, { status: 500 });
  }
}
