import { NextRequest, NextResponse } from "next/server";

const DOORAY_API_BASE = "https://api.dooray.com";

export async function GET(request: NextRequest) {
  const token = request.headers.get("x-dooray-token");
  const projectId = request.nextUrl.searchParams.get("projectId");

  if (!projectId || !token) {
    return NextResponse.json(
      { error: "projectId와 토큰이 필요합니다." },
      { status: 400 }
    );
  }

  const headers = {
    Authorization: `dooray-api ${token}`,
    "Content-Type": "application/json",
  };

  // 1. Project members (raw response, 2 items)
  const membersRes = await fetch(
    `${DOORAY_API_BASE}/project/v1/projects/${projectId}/members?page=0&size=2`,
    { headers }
  );
  const membersData = await membersRes.json();
  const firstMemberId = membersData.result?.[0]?.organizationMemberId;

  // 2. Member detail (full)
  let memberDetail = null;
  if (firstMemberId) {
    const detailRes = await fetch(
      `${DOORAY_API_BASE}/common/v1/members/${firstMemberId}`,
      { headers }
    );
    memberDetail = await detailRes.json();
  }

  // 3. Organization departments (teams)
  let departments = null;
  try {
    const deptRes = await fetch(
      `${DOORAY_API_BASE}/common/v1/organizations/-/departments?page=0&size=100`,
      { headers }
    );
    departments = await deptRes.json();
  } catch {}

  // 4. Member with department info
  let memberDeptDetail = null;
  if (firstMemberId) {
    try {
      const res = await fetch(
        `${DOORAY_API_BASE}/common/v1/members/${firstMemberId}/departments`,
        { headers }
      );
      memberDeptDetail = await res.json();
    } catch {}
  }

  // 5. Project member groups
  let memberGroups = null;
  try {
    const res = await fetch(
      `${DOORAY_API_BASE}/project/v1/projects/${projectId}/member-groups?page=0&size=100`,
      { headers }
    );
    memberGroups = await res.json();
  } catch {}

  return NextResponse.json({
    projectMembers: membersData,
    memberDetail,
    memberDepartments: memberDeptDetail,
    organizationDepartments: departments,
    projectMemberGroups: memberGroups,
  });
}
