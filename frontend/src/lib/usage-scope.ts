import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";

/**
 * 개인용 사용량/성과 화면의 조회 범위 결정 — 어드민 아님.
 * 조직장(is_leader)이면 본인 말단 조직(units 배열의 마지막 단위) 전체를 본다:
 *  - 팀장 → 그 팀, 센터장 → 센터 산하 모든 팀, 본부장 → 본부 전체 (units 포함 비교라 자동으로 하위 포함)
 * is_leader가 null이면 직책(duty)으로 자동 판정, false면 강제로 본인만.
 * 판정 데이터: company_directory (그룹웨어 조직도), 어드민 조직/팀 탭에서 체크박스로 관리.
 */

const LEADER_DUTY_RE = /(팀장|센터장|실장|소장|본부장|부문장|그룹장|연구소장|대표)/;

export interface ScopeMember {
  email: string;
  name: string | null;
  team: string | null;
  duty: string | null;
}

export interface UsageScope {
  email: string;
  name: string | null;
  team: string | null;
  scope: "self" | "org";
  scopeLabel: string;
  members: ScopeMember[]; // 본인 포함, 조회가 허용된 전체 대상
}

interface DirRow { email: string; name: string | null; units: string[] | null; team: string | null; headquarters: string | null; division: string | null; duty: string | null; is_leader?: boolean | null }

const DIR_COLS = "email, name, units, team, headquarters, division, duty, is_leader";

export async function resolveUsageScope(): Promise<
  { ok: true; scope: UsageScope; admin: SupabaseClient } | { ok: false; response: NextResponse }
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role, display_name").eq("user_id", user.id).single();
  if (!profile || profile.role === "guest") {
    return { ok: false, response: NextResponse.json({ error: "승인된 사용자만 볼 수 있습니다." }, { status: 403 }) };
  }
  const c = adminClientOr500();
  if (!c.ok) return { ok: false, response: c.response };
  const admin = c.admin;

  const email = user.email.toLowerCase();
  // is_leader 컬럼이 아직 없으면(마이그레이션 전) 컬럼 없이 재시도
  let me = await admin.from("company_directory").select(DIR_COLS).eq("active", true).ilike("email", email).maybeSingle();
  let hasLeaderCol = true;
  if (me.error && /is_leader/.test(me.error.message)) {
    hasLeaderCol = false;
    me = await admin.from("company_directory").select(DIR_COLS.replace(", is_leader", "")).eq("active", true).ilike("email", email).maybeSingle();
  }
  const my = (me.data ?? null) as DirRow | null;
  const self: ScopeMember = { email, name: my?.name ?? profile.display_name ?? null, team: my?.team ?? null, duty: my?.duty ?? null };

  // 말단 단위 = units 마지막(팀/센터/본부/부문 무엇이든) — 하위 조직은 units에 이 값을 포함한다
  const myUnit = my?.units?.length ? my.units[my.units.length - 1] : my?.team ?? my?.headquarters ?? my?.division ?? null;
  const isLeader = my
    ? my.is_leader === true || (my.is_leader == null && LEADER_DUTY_RE.test(my.duty ?? ""))
    : false;

  let scope: UsageScope["scope"] = "self";
  let scopeLabel = "내 데이터";
  let members: ScopeMember[] = [self];

  if (isLeader && myUnit) {
    const rows = await admin
      .from("company_directory")
      .select(hasLeaderCol ? DIR_COLS : DIR_COLS.replace(", is_leader", ""))
      .eq("active", true)
      .contains("units", [myUnit])
      .limit(400);
    if (!rows.error && (rows.data?.length ?? 0) > 0) {
      const seen = new Map<string, ScopeMember>([[email, self]]);
      for (const r of (rows.data ?? []) as unknown as DirRow[]) {
        const e = r.email.toLowerCase();
        if (!seen.has(e)) seen.set(e, { email: e, name: r.name, team: r.team, duty: r.duty });
      }
      members = [...seen.values()];
      scope = "org";
      scopeLabel = `${myUnit} (${members.length}명)`;
    }
  }

  return { ok: true, admin, scope: { email, name: self.name, team: self.team, scope, scopeLabel, members } };
}
