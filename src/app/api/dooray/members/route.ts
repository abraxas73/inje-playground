import { NextRequest, NextResponse } from "next/server";
import { fetchProjectMembers } from "@/lib/dooray";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const token = request.headers.get("x-dooray-token");

  if (!projectId || !token) {
    return NextResponse.json(
      { error: "projectId와 토큰이 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const members = await fetchProjectMembers(token, projectId);
    return NextResponse.json({ members });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "멤버 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
