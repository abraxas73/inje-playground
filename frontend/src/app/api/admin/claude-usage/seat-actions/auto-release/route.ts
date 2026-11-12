import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { logAudit } from "@/lib/audit";
import { AUTO_REQUESTER, IDLE_DAYS, minusDays, pickIdleSeats } from "@/lib/claude-usage/idle-seats";

export const runtime = "nodejs";

/**
 * 7일 미사용 시트 자동 해제 요청 — 매일 09:05 사용량 수집 래퍼가 수집 뒤에 부른다(Bearer OPS_INGEST_TOKEN).
 * 오늘(20시간 안) CSV가 올라온 team 조직만 본다(수집 실패한 조직은 오래된 데이터로 판정하지 않음).
 * 대상은 수동 해제와 같은 claude_seat_actions 요청(요청자 "자동 해제(7일 미사용)")으로 넣고 실행기가 처리한다 — 이력·감사 동일.
 * ?dry=1 이면 넣지 않고 대상만 돌려준다.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const FRESH_MS = 20 * 3_600_000;

export async function POST(request: NextRequest) {
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.OPS_INGEST_TOKEN)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401, headers: NO_STORE });
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const fail = (m: string) => NextResponse.json({ error: m }, { status: 500, headers: NO_STORE });

  const orgs = await admin.from("claude_orgs").select("id").eq("category", "team");
  if (orgs.error) return fail(orgs.error.message);
  const result: { org_id: string; skipped?: string; emails: string[]; requested: number }[] = [];

  for (const { id: org } of orgs.data ?? []) {
    const imp = await admin.from("claude_csv_imports").select("id, period_end, created_at").eq("org_id", org).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (imp.error) return fail(imp.error.message);
    if (!imp.data || Date.now() - Date.parse(imp.data.created_at) > FRESH_MS) { result.push({ org_id: org, skipped: "오늘 CSV 없음", emails: [], requested: 0 }); continue; }
    const pe = imp.data.period_end as string;

    const [members, act] = await Promise.all([
      admin.from("claude_org_members").select("email, role, seat_tier").eq("org_id", org).eq("status", "active"),
      admin.from("claude_member_activity").select("email, last_active").eq("import_id", imp.data.id),
    ]);
    if (members.error) return fail(members.error.message);
    if (act.error) return fail(act.error.message);
    const lastActive = new Map((act.data ?? []).map((r) => [r.email as string, (r.last_active as string | null) ?? null]));
    const since = minusDays(pe, IDLE_DAYS - 1);
    // 1차 후보(소유자·신규·Code 활동 확인 전)로 아래 조회 범위를 좁힌다
    const rough = (members.data ?? []).filter((m) => lastActive.has(m.email) && (lastActive.get(m.email) ?? "") < since).map((m) => m.email as string);
    if (rough.length === 0) { result.push({ org_id: org, emails: [], requested: 0 }); continue; }

    const [old, code, assigned] = await Promise.all([
      admin.from("claude_member_activity").select("email").eq("org_id", org).lte("period_end", minusDays(pe, IDLE_DAYS)).gte("period_end", minusDays(pe, IDLE_DAYS * 2)).in("email", rough),
      admin.from("claude_code_daily").select("user_email, sessions, prompts, cost_usd").gte("day", since).in("user_email", rough),
      admin.from("claude_seat_actions").select("email").eq("org_id", org).eq("action", "assign").eq("status", "done").gte("finished_at", new Date(Date.now() - IDLE_DAYS * 86_400_000).toISOString()).in("email", rough),
    ]);
    if (old.error) return fail(old.error.message);
    if (code.error) return fail(code.error.message);
    if (assigned.error) return fail(assigned.error.message);

    const emails = pickIdleSeats({
      periodEnd: pe,
      members: members.data ?? [],
      lastActive,
      tenured: new Set((old.data ?? []).map((r) => r.email as string)),
      codeActive: new Set((code.data ?? []).filter((r) => Number(r.sessions) > 0 || Number(r.prompts) > 0 || Number(r.cost_usd) > 0).map((r) => r.user_email as string)),
      recentlyAssigned: new Set((assigned.data ?? []).map((r) => r.email as string)),
    });

    let requested = 0;
    if (!dry) {
      for (const email of emails) {
        const ins = await admin.from("claude_seat_actions")
          .insert({ org_id: org, email, action: "unassign", target_tier: null, requested_by: AUTO_REQUESTER.id, requested_by_email: AUTO_REQUESTER.email })
          .select("id").single();
        if (ins.error) {
          if (ins.error.code === "23505") continue; // 이미 대기·실행 중인 요청
          return fail(ins.error.message);
        }
        requested++;
        await logAudit(admin, request, { userId: null, userEmail: AUTO_REQUESTER.email, action: "시트 해제 요청", category: "usage", detail: { action_id: ins.data.id, org_id: org, email, action: "unassign", reason: `최근 ${IDLE_DAYS}일 사용 0(~${pe})` } });
      }
    }
    result.push({ org_id: org, emails, requested });
  }
  return NextResponse.json({ dry, orgs: result }, { headers: NO_STORE });
}
