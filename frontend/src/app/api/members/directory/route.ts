import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import type { Member } from "@/lib/members/types";

export const runtime = "nodejs";

/**
 * GET /api/members/directory — 사내 조직도 명부(company_directory, active)를 Member[]로 반환. 멤버 소스 provider "directory"용.
 * company_directory는 RLS가 관리자 전용이라, 로그인 사용자(user 이상)를 확인한 뒤 service role로 읽는다. id는 이메일(Teams DM 수신자로 그대로 쓴다).
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.admin.from("company_directory").select("email, name, team, units").eq("active", true).order("name");
  if (error) return NextResponse.json({ error: `조직도 명부 조회 실패: ${error.message}` }, { status: 500 });
  const members: Member[] = [];
  for (const row of (data ?? []) as Array<{ email?: string | null; name?: string | null; team?: string | null; units?: string[] | null }>) {
    const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!email || !name) continue;
    const units = Array.isArray(row.units) ? row.units.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
    members.push({ id: email, name, email, ...(row.team ? { team: row.team } : {}), ...(units.length ? { units } : {}) });
  }
  if (!members.length) return NextResponse.json({ error: "사내 조직도 명부가 비어 있습니다. 관리자 > 조직/팀에서 동기화 상태를 확인하세요." }, { status: 503 });
  members.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return NextResponse.json({ members, source: "directory" }, { headers: { "Cache-Control": "no-store" } });
}
