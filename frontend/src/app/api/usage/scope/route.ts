import { NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";

/** GET /api/usage/scope — 개인용 사용량 화면의 조회 범위(본인/팀/본부)와 대상 명단 */
export async function GET() {
  const r = await resolveUsageScope();
  if (!r.ok) return r.response;
  const { scope } = r;
  return NextResponse.json({
    email: scope.email,
    name: scope.name,
    team: scope.team,
    scope: scope.scope,
    scopeLabel: scope.scopeLabel,
    members: scope.members.map((m) => ({ email: m.email, name: m.name, team: m.team })),
  });
}
