import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { createShareLink, isShareVisibility, loadShareLinks, shareOrigin } from "@/lib/rfp/share";
import { logAudit } from "@/lib/audit";
import type { ShareLinksResponse } from "@/types/rfp";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 공유 링크는 프로젝트를 등록한 사람(또는 admin)만 만들고 폐기한다 — 삭제 권한과 같은 기준 */
async function ownerCheck(auth: Extract<Awaited<ReturnType<typeof requireUser>>, { ok: true }>, id: string) {
  const { data, error } = await auth.admin.from("rfp_projects").select("id, created_by").eq("id", id).maybeSingle();
  if (error) return { ok: false as const, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!data) return { ok: false as const, response: NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 }) };
  const canManage = auth.role === "admin" || (data as { created_by: string | null }).created_by === auth.userId;
  return { ok: true as const, canManage };
}

/** GET /api/rfp/projects/[id]/shares → {links, canManage} — 링크 목록은 관리 권한이 있는 사람만 본다 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });
  const owner = await ownerCheck(auth, id);
  if (!owner.ok) return owner.response;
  if (!owner.canManage) {
    const body: ShareLinksResponse = { links: [], canManage: false };
    return NextResponse.json(body);
  }
  try {
    const body: ShareLinksResponse = { links: await loadShareLinks(auth.admin, id, shareOrigin(request)), canManage: true };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "공유 링크를 불러오지 못했습니다." }, { status: 500 });
  }
}

/**
 * POST /api/rfp/projects/[id]/shares {visibility: "public"|"private"} → {link}
 * public 링크는 로그인 없이 열리므로 만든 사실을 감사 로그에 남긴다(토큰은 남기지 않는다).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });
  const owner = await ownerCheck(auth, id);
  if (!owner.ok) return owner.response;
  if (!owner.canManage) return NextResponse.json({ error: "이 프로젝트를 등록한 사람 또는 관리자만 공유 링크를 만들 수 있습니다." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { visibility?: unknown } | null;
  if (!isShareVisibility(body?.visibility)) {
    return NextResponse.json({ error: "visibility는 public 또는 private입니다." }, { status: 400 });
  }
  const created = await createShareLink(auth.admin, id, body.visibility, auth.userId, shareOrigin(request));
  if (!created.ok) return NextResponse.json({ error: created.message }, { status: created.status });

  await logAudit(auth.admin, request, {
    userId: auth.userId, action: "공유 링크 생성", category: "rfp",
    detail: { projectId: id, visibility: created.link.visibility, linkId: created.link.id },
  });
  return NextResponse.json({ link: created.link }, { status: 201 });
}
