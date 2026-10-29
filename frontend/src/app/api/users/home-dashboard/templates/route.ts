import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { createTemplate, listTemplates, parseDashboard, HOME_DASHBOARD_MAX, TEMPLATE_PER_USER_MAX } from "@/lib/home-dashboard";

/** GET /api/users/home-dashboard/templates — 기본 템플릿 + 공유된 템플릿 목록. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ templates: await listTemplates(auth.admin, auth.userId) });
  } catch {
    return NextResponse.json({ error: "템플릿을 불러오지 못했습니다." }, { status: 500 });
  }
}

/** POST {name, tiles} — 내 배치를 이름 붙여 공유. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 40) return NextResponse.json({ error: "템플릿 이름은 1~40자로 적어 주세요." }, { status: 400 });
  if (!Array.isArray(b.tiles) || b.tiles.length > HOME_DASHBOARD_MAX) return NextResponse.json({ error: "배치 정보가 올바르지 않습니다." }, { status: 400 });
  const tiles = parseDashboard(JSON.stringify(b.tiles));
  if (!tiles.length) return NextResponse.json({ error: "공유할 위젯이 없습니다." }, { status: 400 });
  try {
    const id = await createTemplate(auth.admin, { userId: auth.userId, email: auth.email ?? "" }, name, tiles);
    if (!id) return NextResponse.json({ error: `템플릿은 한 사람당 ${TEMPLATE_PER_USER_MAX}개까지 공유할 수 있습니다. 안 쓰는 것을 지운 뒤 다시 공유해 주세요.` }, { status: 409 });
    return NextResponse.json({ id });
  } catch {
    return NextResponse.json({ error: "템플릿을 공유하지 못했습니다." }, { status: 500 });
  }
}
