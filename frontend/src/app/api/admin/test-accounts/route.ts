import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { logAudit } from "@/lib/audit";
import { generatePassword, validateDisplayName, validateEmail, validatePassword } from "@/lib/auth/test-account";
import { listTestAccounts, toTestAccountRow } from "@/lib/auth/test-account-admin";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * 테스트 전용 이메일 계정(애플 심사·공개 테스트). 런북 docs/test-accounts.md
 * GET  — 목록(id·이메일·이름·생성·최근 로그인·비활성 여부)
 * POST {email, displayName, password?} — 생성. 비밀번호를 안 주면 서버가 만들어 **응답으로 한 번만** 돌려준다.
 * 비밀번호는 감사·로그 어디에도 남기지 않는다.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  try {
    return NextResponse.json({ accounts: await listTestAccounts(c.admin) }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const invalid = validateEmail(body?.email) ?? validateDisplayName(body?.displayName)
    ?? (body?.password != null && body.password !== "" ? validatePassword(body.password) : null);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const email = String(body!.email).trim().toLowerCase();
  const name = String(body!.displayName).trim();
  const generated = !body!.password;
  const password = generated ? generatePassword() : String(body!.password);

  const { data, error } = await c.admin.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { test_account: true },
    user_metadata: { full_name: name },
  });
  if (error || !data.user) {
    const status = error?.status === 422 || /already/i.test(error?.message ?? "") ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? "이미 있는 이메일입니다." : `계정을 만들지 못했습니다: ${error?.message ?? "알 수 없는 오류"}` }, { status });
  }

  await logAudit(c.admin, request, {
    userId: auth.userId, userEmail: auth.email, action: "테스트 계정 생성", category: "users",
    detail: { targetEmail: email, targetUserId: data.user.id, generatedPassword: generated },
  });
  return NextResponse.json({ account: toTestAccountRow(data.user), password }, { status: 201, headers: NO_STORE });
}
