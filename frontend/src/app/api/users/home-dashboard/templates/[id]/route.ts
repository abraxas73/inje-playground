import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { deleteTemplate } from "@/lib/home-dashboard";

/** DELETE — 내가 공유한 템플릿 삭제(기본 템플릿·남의 것은 관리자만). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
  try {
    if (!(await deleteTemplate(auth.admin, auth, id))) return NextResponse.json({ error: "지울 수 없는 템플릿입니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "템플릿을 지우지 못했습니다." }, { status: 500 });
  }
}
