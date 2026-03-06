import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const token = request.headers.get("x-dooray-token");

  if (!projectId || !token) {
    return NextResponse.json(
      { error: "projectId와 토큰이 필요합니다." },
      { status: 400 }
    );
  }

  // 1. Get member IDs
  const membersRes = await fetch(
    `https://api.dooray.com/project/v1/projects/${projectId}/members?page=0&size=2`,
    {
      headers: {
        Authorization: `dooray-api ${token}`,
        "Content-Type": "application/json",
      },
    }
  );
  const membersData = await membersRes.json();
  const firstMemberId = membersData.result?.[0]?.organizationMemberId;

  // 2. Try to get member detail
  let memberDetail = null;
  if (firstMemberId) {
    const detailRes = await fetch(
      `https://api.dooray.com/common/v1/members/${firstMemberId}`,
      {
        headers: {
          Authorization: `dooray-api ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    memberDetail = await detailRes.json();
  }

  return NextResponse.json({ membersData, memberDetail });
}
