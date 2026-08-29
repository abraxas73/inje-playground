import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";

/**
 * 관리자용 사용자 상세/삭제.
 * GET    /api/users/[id]  — 프로필 + 개인 설정(토큰 마스킹) + 최근 로그인 10건 + 사내 조직도 소속 + 활동 요약(가이드 질의·내 팀·Claude Code 30일)
 * DELETE /api/users/[id]  — 개인 데이터(설정·내 팀·로그인 이력·가이드 질의) → 프로필 → 로그인 계정(auth.users) 순으로 삭제.
 *                            자기 자신·관리자 역할은 거부(관리자는 먼저 역할을 바꾼 뒤 삭제).
 * [id] = user_profiles.user_id (= auth.users.id)
 */

type Params = { params: Promise<{ id: string }> };

function kstDayOffset(daysAgo: number): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000 - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  const { id } = await params;

  const prof = await admin.from("user_profiles").select("*").eq("user_id", id).maybeSingle();
  if (prof.error) return NextResponse.json({ error: prof.error.message }, { status: 500 });
  if (!prof.data) return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  const email = String(prof.data.email ?? "").toLowerCase();
  const since = kstDayOffset(29);

  const [settings, logins, directory, guideCount, usage, members] = await Promise.all([
    admin.from("user_settings").select("key, value").eq("user_id", id),
    admin.from("login_history").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(10),
    email ? admin.from("company_directory").select("division, headquarters, team, duty, position, active, dept_path").eq("email", email).maybeSingle() : Promise.resolve({ data: null, error: null }),
    email ? admin.from("nlm_chat_messages").select("*", { count: "exact", head: true }).eq("user_email", email) : Promise.resolve({ count: 0, error: null }),
    email ? admin.from("claude_code_daily").select("day, sessions, cost_usd, prompts").eq("user_email", email).gte("day", since) : Promise.resolve({ data: [], error: null }),
    admin.from("user_members").select("*", { count: "exact", head: true }).eq("user_id", id),
  ]);

  // login_history에 created_at이 없는 스키마면 정렬 없이 재조회(열 이름이 달라도 상세는 내려준다)
  let loginRows: Record<string, unknown>[] = (logins.data ?? []) as Record<string, unknown>[];
  if (logins.error) {
    const retry = await admin.from("login_history").select("*").eq("user_id", id).limit(10);
    loginRows = (retry.data ?? []) as Record<string, unknown>[];
  }

  const maskedSettings = ((settings.data ?? []) as { key: string; value: string | null }[]).map((s) => ({
    key: s.key,
    value: s.key.includes("token") && s.value ? s.value.slice(0, 8) + "***" : s.value,
  }));

  const rows = ((usage.data ?? []) as { day: string; sessions: number | string; cost_usd: number | string; prompts: number | string }[]);
  const claude = rows.reduce(
    (acc, r) => {
      acc.sessions += Number(r.sessions) || 0;
      acc.cost_usd += Number(r.cost_usd) || 0;
      acc.prompts += Number(r.prompts) || 0;
      if (Number(r.sessions) > 0 || Number(r.cost_usd) > 0) acc.active_days += 1;
      if (!acc.last_day || r.day > acc.last_day) acc.last_day = r.day;
      return acc;
    },
    { sessions: 0, cost_usd: 0, prompts: 0, active_days: 0, last_day: null as string | null, since }
  );

  return NextResponse.json({
    profile: prof.data,
    isSelf: auth.userId === id,
    settings: maskedSettings,
    logins: loginRows,
    directory: directory.error ? null : directory.data,
    activity: {
      guide_questions: guideCount.error ? null : guideCount.count ?? 0,
      team_members: members.error ? null : members.count ?? 0,
      claude_code_30d: usage.error ? null : claude,
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  const { id } = await params;

  if (id === auth.userId) return NextResponse.json({ error: "자기 자신은 삭제할 수 없습니다." }, { status: 400 });
  const prof = await admin.from("user_profiles").select("user_id, email, role").eq("user_id", id).maybeSingle();
  if (prof.error) return NextResponse.json({ error: prof.error.message }, { status: 500 });
  if (!prof.data) return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  if (prof.data.role === "admin") {
    return NextResponse.json({ error: "관리자 계정은 삭제할 수 없습니다. 먼저 역할을 '사용자'로 변경하세요." }, { status: 400 });
  }
  const email = String(prof.data.email ?? "").toLowerCase();

  // 개인 데이터 먼저(각 테이블은 독립적으로 시도하고 결과를 보고한다)
  const deleted: Record<string, number | string> = {};
  const del = async (table: string, col: string, val: string) => {
    const r = await admin.from(table).delete().eq(col, val).select(col);
    deleted[table] = r.error ? `error: ${r.error.message}` : (r.data?.length ?? 0);
  };
  await del("user_settings", "user_id", id);
  await del("user_members", "user_id", id);
  await del("login_history", "user_id", id);
  if (email) await del("nlm_chat_messages", "user_email", email);

  const p = await admin.from("user_profiles").delete().eq("user_id", id).select("user_id");
  if (p.error) return NextResponse.json({ error: `user_profiles 삭제 실패: ${p.error.message}`, deleted }, { status: 500 });
  deleted.user_profiles = p.data?.length ?? 0;

  // 로그인 계정 제거 — 이후 같은 계정으로 다시 로그인하면 새 프로필(게스트)이 생성된다
  const a = await admin.auth.admin.deleteUser(id);
  const warning = a.error ? `프로필은 삭제됐지만 로그인 계정 삭제에 실패했습니다: ${a.error.message}` : null;

  return NextResponse.json({ ok: true, email, deleted, authDeleted: !a.error, warning });
}
