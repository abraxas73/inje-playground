import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, numify } from "@/lib/claude-usage/require-admin";
import { selectAll } from "@/lib/work-metrics/common";
import { overlaySeat, summarize } from "@/lib/claude-usage/seat-actions";
import { mergeWindowRows, pickWindowImports } from "@/lib/claude-usage/csv-windows";
import type { SeatAction, SeatExecutor } from "@/types/claude-seat";
import type { MemberActivityRow } from "@/types/claude-usage";

/**
 * GET /api/admin/claude-usage/members?org=all|<id>&importId=latest|<uuid>&periodEnd=latest|YYYY-MM-DD — CSV 멤버 활동
 * - periodEnd(YYYY-MM-DD): 데이터 기간 종료일이 그 날짜인 CSV 중 조직별 최신 업로드를 고른다(화면의 "데이터 기간" 선택).
 * - importId(uuid): 특정 업로드 하나. 둘 다 없으면 조직별 최신 업로드.
 * - windows(1|2|3, 기본 1): 종료일에서 30일씩 거슬러 간 창을 조직별로 골라(±3일) 멤버별 합계로 이어 붙인다(60·90일). 응답 windows에 창별 수집 조직 수.
 * 응답 imports는 선택과 무관하게 org 범위의 전체 업로드 목록(기간 옵션용), period는 선택된 CSV들의 데이터 기간.
 * 각 행에 code_prompts(같은 데이터 기간의 Claude Code 프롬프트 수, OTel claude_code_daily, Claude 조직 무관 이메일 합)와
 * office_turns(같은 기간의 Excel·Word·PowerPoint 추가 기능 턴 수, RPC claude_office_usage)를 붙인다 — 채팅은 0이어도 다른 제품을 쓰는 시트를 구분하기 위함.
 * 행의 seat_tier는 claude_org_members(active, 매일 갱신 + 시트 작업 완료 시 즉시 갱신)가 있으면 그 값으로 덮고, seat_action(대기·실행 중 또는 24시간 안의 마지막 요청)과 executor(실행기 하트비트)를 붙인다.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const org = sp.get("org") ?? "all";
  const importId = sp.get("importId") ?? "latest";
  const periodEnd = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("periodEnd") ?? "") ? (sp.get("periodEnd") as string) : null;
  const windows = Math.min(3, Math.max(1, Number(sp.get("windows") ?? 1) || 1));

  let importsQ = admin
    .from("claude_csv_imports")
    .select("id, org_id, period_start, period_end, filename, row_count, unknown_headers, created_at")
    .order("period_end", { ascending: false })
    .order("created_at", { ascending: false });
  if (org !== "all") importsQ = importsQ.eq("org_id", org);
  const imports = await importsQ;
  if (imports.error) return NextResponse.json({ error: imports.error.message }, { status: 500 });

  type Imp = { id: string; org_id: string; period_start: string; period_end: string };
  const all = (imports.data ?? []) as Imp[];
  let selected: Imp[];
  const windowOf = new Map<string, number>(); // import id → 창 번호(0 = 최신)
  let picks: { target: string; imports: Imp[] }[] = [];
  if (importId !== "latest") {
    selected = all.filter((i) => i.id === importId);
  } else {
    // period_end desc, created_at desc 정렬이라 같은 period_end 안에서는 먼저 온 것이 최신 업로드. 종료일 없으면 가장 최근 종료일
    const end = periodEnd ?? all[0]?.period_end ?? null;
    picks = end ? pickWindowImports(all, end, windows) : [];
    selected = picks.flatMap((p, w) => { for (const i of p.imports) windowOf.set(i.id, w); return p.imports; });
  }
  const ids = selected.map((i) => i.id);
  const windowInfo = picks.map((p) => ({
    target: p.target, orgs: p.imports.length,
    period_start: p.imports.length ? p.imports.map((i) => i.period_start).sort()[0] : null,
    period_end: p.imports.length ? p.imports.map((i) => i.period_end).sort().at(-1)! : null,
  }));
  const period = selected.length
    ? { start: selected.map((i) => i.period_start).sort()[0], end: selected.map((i) => i.period_end).sort().at(-1)! }
    : null;
  const rows = ids.length
    ? await admin.from("claude_member_activity").select("*").in("import_id", ids).order("chats", { ascending: false })
    : { data: [] as Record<string, unknown>[], error: null };
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });
  // 창이 여러 개면 창별로 나눠 조직·이메일별 합계로 이어 붙인다(숫자는 합, 이름·티어는 최신 창)
  type ActRow = MemberActivityRow & { org_id: string; import_id: string };
  const rowsByWindow: ActRow[][] = Array.from({ length: Math.max(1, picks.length) }, () => []);
  for (const r of (rows.data ?? []) as ActRow[]) rowsByWindow[windowOf.get(r.import_id) ?? 0].push(r);
  const activity = mergeWindowRows(rowsByWindow);

  // 사내 조직도 명부(재직자)로 소속(team/division) 조인 — 실패해도 표는 내려준다
  const directory = await admin.from("company_directory").select("email, name, team, headquarters, division, units").eq("active", true).limit(1000);
  type Dir = { email: string; name: string | null; team: string | null; headquarters: string | null; division: string | null; units: string[] | null };
  const dirByEmail = new Map(((directory.error ? [] : directory.data ?? []) as Dir[]).map((d) => [d.email.toLowerCase(), d]));
  // parent_unit = 조직도 경로에서 팀 바로 위 단위(센터 등). headquarters는 본부라 센터가 빠진다
  const parentUnit = (d: Dir | undefined): string | null => (d?.units && d.units.length >= 2 ? d.units[d.units.length - 2] : null);
  // Claude Code 프롬프트 수(OTel) — 선택된 CSV 데이터 기간, 조직 무관 이메일 합. 실패해도 표는 내려준다
  const codePrompts = new Map<string, { human: number; auto: number }>();
  if (period) {
    const cp = await selectAll<{ user_email: string; prompts: number | string; prompts_auto: number | string }>(() =>
      admin.from("claude_code_daily").select("user_email, prompts, prompts_auto", { count: "exact" }).gte("day", period.start).lte("day", period.end).order("day").order("org_id").order("user_email")
    );
    for (const r of cp.data ?? []) {
      const k = r.user_email.toLowerCase();
      const v = codePrompts.get(k) ?? { human: 0, auto: 0 };
      v.human += Number(r.prompts) - Number(r.prompts_auto);
      v.auto += Number(r.prompts_auto);
      codePrompts.set(k, v);
    }
  }
  // Office Agents 턴(OTel 수집기) — 데이터 기간, 조직 무관 이메일 합. 함수가 없거나 실패해도 표는 내려준다
  const officeTurns = new Map<string, number>();
  if (period) {
    const of = await admin.rpc("claude_office_usage", { p_from: period.start, p_to: period.end, p_emails: null, p_org: null });
    for (const r of (of.error ? [] : of.data ?? []) as { user_email: string; turns: number | string }[]) {
      const k = r.user_email.toLowerCase();
      officeTurns.set(k, (officeTurns.get(k) ?? 0) + Number(r.turns));
    }
  }
  const withTeam = activity.map((r) => {
    const rec = numify(r as unknown as Record<string, unknown>);
    const email = String(rec.email ?? "").toLowerCase();
    const d = dirByEmail.get(email);
    return { ...rec, employee_name: d?.name ?? null, team: d?.team ?? null, parent_unit: parentUnit(d), headquarters: d?.headquarters ?? null, division: d?.division ?? null, code_prompts: codePrompts.get(email)?.human ?? 0, code_prompts_auto: codePrompts.get(email)?.auto ?? 0, office_turns: officeTurns.get(email) ?? 0 };
  });
  // 시트 작업: claude_org_members 티어로 덮고(CSV는 최대 하루 낡음), 요청 요약·실행기 상태를 붙인다. 표가 없거나 실패해도 표는 내려준다
  const orgIds = [...new Set(withTeam.map((r) => String((r as Record<string, unknown>).org_id)))];
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [om, acts, ex] = await Promise.all([
    orgIds.length
      ? selectAll<{ org_id: string; email: string; seat_tier: string | null }>(() =>
          admin.from("claude_org_members").select("org_id, email, seat_tier", { count: "exact" }).in("org_id", orgIds).eq("status", "active").order("org_id").order("email")
        )
      : Promise.resolve({ data: [] as { org_id: string; email: string; seat_tier: string | null }[], error: null }),
    orgIds.length
      ? selectAll<SeatAction>(() =>
          admin
            .from("claude_seat_actions")
            .select("*", { count: "exact" })
            .in("org_id", orgIds)
            .or(`status.in.(requested,running),requested_at.gte.${since}`)
            .order("requested_at", { ascending: false })
            .order("id")
        )
      : Promise.resolve({ data: [] as SeatAction[], error: null }),
    orgIds.length
      ? admin.from("claude_seat_executor").select("*").eq("id", "default").maybeSingle()
      : Promise.resolve({ data: null as SeatExecutor | null, error: null as { message: string } | null }),
  ]);
  if (om.error) console.warn("[claude-usage] org_members 조인 실패:", om.error.message);
  if (acts.error) console.warn("[claude-usage] seat_actions 조인 실패:", acts.error.message);
  type SeatRow = { org_id: string; email: string; seat_tier: string };
  const rowsOut = overlaySeat(
    withTeam as unknown as SeatRow[],
    (om.error ? [] : om.data ?? []) as { org_id: string; email: string; seat_tier: string | null }[],
    summarize((acts.error ? [] : acts.data ?? []) as SeatAction[], new Date()),
  );
  const executor = (ex.error ? null : ex.data ?? null) as SeatExecutor | null;
  return NextResponse.json({ imports: all, rows: rowsOut, period, executor, windows: windowInfo });
}
