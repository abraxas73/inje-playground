import { NextRequest, NextResponse } from "next/server";
import { nlmFetch } from "@/lib/nlm-service";

/** GET /api/dooray/projects — Dooray 프로젝트 목록 조회 (nlm-service 프록시) */
export async function GET(request: NextRequest) {
  const token = request.headers.get("x-dooray-token");

  if (!token) {
    return NextResponse.json(
      { error: "토큰이 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const data = await nlmFetch("/dooray/projects", {
      headers: { "x-dooray-token": token },
    });
    return NextResponse.json({ projects: data.projects || [] });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "프로젝트 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
