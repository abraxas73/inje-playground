import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { buildOrg, type DeptRow, type PersonRow } from "@/lib/directory/org";

export const runtime = "nodejs";

/**
 * GET /api/directory/org — 조직도(부서 트리 + 재직자). 페이지 키 org_chart(proxy가 권한 확인), user 이상.
 * company_directory·company_departments는 RLS가 막혀 있어 로그인 확인 뒤 service role로 읽는다. 휴대폰 번호는 원래 저장하지 않는다.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const [deps, people, sync] = await Promise.all([
    auth.admin.from("company_departments").select("id, parent_id, name, sort, depth").eq("active", true),
    auth.admin.from("company_directory").select("email, emp_seq, name, dept_id, dept_name, units, duty, position").eq("active", true).range(0, 4999),
    auth.admin.from("company_directory_sync").select("synced_at").order("synced_at", { ascending: false }).limit(1),
  ]);
  if (people.error) return NextResponse.json({ error: `조직도 명부 조회 실패: ${people.error.message}` }, { status: 500 });
  // 부서 테이블이 아직 없거나 비면(SQL 적용 전·첫 동기화 전) 사람들의 부서 경로로 트리를 만든다
  const deptRows = deps.error ? [] : ((deps.data ?? []) as DeptRow[]);
  const data = buildOrg(deptRows, (people.data ?? []) as PersonRow[], (sync.data?.[0]?.synced_at as string | undefined) ?? null);
  if (!data.people.length) return NextResponse.json({ error: "조직도 명부가 비어 있습니다. 동기화 상태를 확인하세요." }, { status: 503 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=60" } });
}
