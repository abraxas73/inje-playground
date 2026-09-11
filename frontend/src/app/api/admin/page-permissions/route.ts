import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { isPagePermissions } from "@/lib/page-access";
import { logAudit } from "@/lib/audit";

async function requireAdmin() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  const { data } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  if (data?.role !== "admin") return { ok: false as const, response: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }) };
  return { ok: true as const, supabase, user };
}
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const [profiles, access] = await Promise.all([
    auth.supabase.from("user_profiles").select("user_id,email,display_name,role").order("display_name"),
    auth.supabase.from("user_page_access").select("user_id,permissions,version,updated_at"),
  ]);
  if (profiles.error || access.error) return NextResponse.json({ error: "접근 권한 목록을 불러오지 못했습니다." }, { status: 500 });
  const byUser = new Map((access.data ?? []).map((a) => [a.user_id, a]));
  return NextResponse.json({ users: (profiles.data ?? []).map((p) => ({ ...p, permissions: byUser.get(p.user_id)?.permissions ?? {}, version: byUser.get(p.user_id)?.version ?? 0, updated_at: byUser.get(p.user_id)?.updated_at ?? null })) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function PUT(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 }); }
  if (!body || typeof body.userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.userId) || !isPagePermissions(body.permissions) || !Number.isSafeInteger(body.version) || body.version < 0) return NextResponse.json({ error: "사용자와 페이지 권한을 확인해 주세요." }, { status: 400 });
  const { data, error } = await auth.supabase.rpc("set_user_page_access", { p_user_id: body.userId, p_permissions: body.permissions, p_expected_version: body.version });
  if (error) {
    const status = error.code === "40001" ? 409 : error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ error: status === 409 ? "다른 관리자가 권한을 변경했습니다. 목록을 새로고침하고 다시 설정해 주세요." : status === 400 ? "관리자는 항상 전체 접근이 허용됩니다. 입력을 확인해 주세요." : "페이지 접근 권한을 저장하지 못했습니다." }, { status });
  }
  await logAudit(auth.supabase, request, { userId: auth.user.id, userEmail: auth.user.email, action: "페이지 접근 권한 변경", category: "users", detail: { targetUserId: body.userId, permissions: body.permissions } });
  return NextResponse.json({ access: Array.isArray(data) ? data[0] : data });
}
