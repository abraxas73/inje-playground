import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";

/**
 * 개인용 사용량/성과 화면의 조회 범위 결정 — 어드민 아님.
 * 규칙(사내 조직도 company_directory의 duty 기준):
 *  - 팀장급(팀장·센터장·실장·소장): 같은 팀(team) 구성원까지
 *  - 임원급(본부장·부문장·그룹장·연구소장·대표): 같은 본부(headquarters, 없으면 부문) 구성원까지
 *  - 그 외(또는 명부에 없음): 본인만
 */

const TEAM_LEAD_RE = /(팀장|센터장|실장|소장)/;
const UNIT_LEAD_RE = /(본부장|부문장|그룹장|연구소장|대표)/;

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
  scope: "self" | "team" | "unit";
  scopeLabel: string;
  members: ScopeMember[]; // 본인 포함, 조회가 허용된 전체 대상
}

interface DirRow { email: string; name: string | null; team: string | null; headquarters: string | null; division: string | null; duty: string | null }

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
  const me = await admin.from("company_directory").select("email, name, team, headquarters, division, duty").eq("active", true).ilike("email", email).maybeSingle();
  const my = (me.data ?? null) as DirRow | null;
  const self: ScopeMember = { email, name: my?.name ?? profile.display_name ?? null, team: my?.team ?? null, duty: my?.duty ?? null };

  let scope: UsageScope["scope"] = "self";
  let scopeLabel = "내 데이터";
  let members: ScopeMember[] = [self];

  const duty = my?.duty ?? "";
  if (my && UNIT_LEAD_RE.test(duty) && (my.headquarters || my.division)) {
    const col = my.headquarters ? "headquarters" : "division";
    const val = my.headquarters ?? my.division!;
    const rows = await admin.from("company_directory").select("email, name, team, headquarters, division, duty").eq("active", true).eq(col, val).limit(300);
    members = dedupe([self, ...((rows.data ?? []) as DirRow[]).map(toMember)]);
    scope = "unit";
    scopeLabel = `${val} (${members.length}명)`;
  } else if (my && TEAM_LEAD_RE.test(duty) && my.team) {
    const rows = await admin.from("company_directory").select("email, name, team, headquarters, division, duty").eq("active", true).eq("team", my.team).limit(100);
    members = dedupe([self, ...((rows.data ?? []) as DirRow[]).map(toMember)]);
    scope = "team";
    scopeLabel = `${my.team} (${members.length}명)`;
  }

  return { ok: true, admin, scope: { email, name: self.name, team: self.team, scope, scopeLabel, members } };
}

function toMember(r: DirRow): ScopeMember {
  return { email: r.email.toLowerCase(), name: r.name, team: r.team, duty: r.duty };
}

function dedupe(list: ScopeMember[]): ScopeMember[] {
  const seen = new Map<string, ScopeMember>();
  for (const m of list) if (!seen.has(m.email)) seen.set(m.email, m);
  return [...seen.values()];
}
