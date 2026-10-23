import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { logAudit } from "@/lib/audit";
import { generatePassword, isTestAccount, validatePassword } from "@/lib/auth/test-account";
import { DISABLE_BAN, toTestAccountRow } from "@/lib/auth/test-account-admin";
import { deleteUserCompletely } from "@/lib/users/delete-user";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };
const NO_STORE = { "Cache-Control": "no-store" };
const ACTIONS = ["reset_password", "disable", "enable"] as const;

/** 대상이 테스트 계정인지 확인(아니면 거부 응답) */
async function loadTarget(id: string) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const c = adminClientOr500();
  if (!c.ok) return c;
  const { data, error } = await c.admin.auth.admin.getUserById(id);
  if (error || !data.user) return { ok: false as const, response: NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 }) };
  if (!isTestAccount(data.user)) return { ok: false as const, response: NextResponse.json({ error: "테스트 계정이 아닙니다." }, { status: 400 }) };
  return { ok: true as const, auth, admin: c.admin, user: data.user };
}

/**
 * PATCH /api/admin/test-accounts/[id]
 * {action:"reset_password", password?} — 새 비밀번호(안 주면 생성)를 응답으로 한 번만 돌려준다
 * {action:"disable"|"enable"} — ban_duration으로 로그인 막기·풀기
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const t = await loadTarget((await params).id);
  if (!t.ok) return t.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action as (typeof ACTIONS)[number];
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "action은 reset_password·disable·enable 중 하나입니다." }, { status: 400 });

  let password: string | undefined;
  if (action === "reset_password") {
    const given = body?.password;
    if (given != null && given !== "") {
      const invalid = validatePassword(given);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    }
    password = given ? String(given) : generatePassword();
  }
  const attrs = action === "reset_password" ? { password } : { ban_duration: action === "disable" ? DISABLE_BAN : "none" };
  const { data, error } = await t.admin.auth.admin.updateUserById(t.user.id, attrs);
  if (error || !data.user) return NextResponse.json({ error: `변경하지 못했습니다: ${error?.message ?? "알 수 없는 오류"}` }, { status: 500 });

  const label = { reset_password: "테스트 계정 비밀번호 재설정", disable: "테스트 계정 비활성화", enable: "테스트 계정 재활성화" }[action];
  await logAudit(t.admin, request, {
    userId: t.auth.userId, userEmail: t.auth.email, action: label, category: "users",
    detail: { targetEmail: t.user.email ?? t.user.id, targetUserId: t.user.id, ...(action === "reset_password" ? { generatedPassword: !body?.password } : {}) },
  });
  return NextResponse.json({ account: toTestAccountRow(data.user), ...(password ? { password } : {}) }, { headers: NO_STORE });
}

/** DELETE — 테스트 계정만. 정리는 관리자 사용자 삭제와 같은 경로(deleteUserCompletely) */
export async function DELETE(request: NextRequest, { params }: Params) {
  const t = await loadTarget((await params).id);
  if (!t.ok) return t.response;
  const email = (t.user.email ?? "").toLowerCase();
  const r = await deleteUserCompletely(t.admin, t.user.id, email);
  if (!r.ok) return NextResponse.json({ error: r.error, deleted: r.deleted }, { status: 500 });
  await logAudit(t.admin, request, {
    userId: t.auth.userId, userEmail: t.auth.email, action: "테스트 계정 삭제", category: "users",
    detail: { targetEmail: email || t.user.id, targetUserId: t.user.id, deleted: r.deleted, authDeleted: r.authDeleted },
  });
  return NextResponse.json({ ok: true, deleted: r.deleted, authDeleted: r.authDeleted, warning: r.warning });
}
