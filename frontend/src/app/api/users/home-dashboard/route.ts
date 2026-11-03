import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { colsOf, loadDashboard, parseDashboard, rescale, saveDashboard, DASHBOARD_FINE_COLS, HOME_DASHBOARD_MAX } from "@/lib/home-dashboard";

/** GET /api/users/home-dashboard?cols=24 — 홈 대시보드 레이아웃(계정 단위). 없으면 빈 배열(앱이 기본 배치를 쓴다). cols 없으면 옛 12칸 단위. */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const cols = colsOf(request.nextUrl.searchParams.get("cols"));
  try {
    return NextResponse.json({ tiles: rescale(await loadDashboard(auth.admin, auth.userId), DASHBOARD_FINE_COLS, cols), cols });
  } catch {
    return NextResponse.json({ error: "대시보드를 불러오지 못했습니다." }, { status: 500 });
  }
}

/** PUT {tiles:[{id,x,y,w,h}], cols?: 24} — 레이아웃 전체 교체(검증 통과분만, 최대 40). cols 없으면 옛 12칸 단위. */
export async function PUT(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!Array.isArray(b.tiles) || b.tiles.length > HOME_DASHBOARD_MAX) {
    return NextResponse.json({ error: "대시보드 정보가 올바르지 않습니다." }, { status: 400 });
  }
  const cols = colsOf(b.cols);
  const tiles = parseDashboard(JSON.stringify(b.tiles), cols);
  try {
    await saveDashboard(auth.admin, auth.userId, rescale(tiles, cols, DASHBOARD_FINE_COLS));
    return NextResponse.json({ tiles, cols });
  } catch {
    return NextResponse.json({ error: "대시보드를 저장하지 못했습니다." }, { status: 500 });
  }
}
