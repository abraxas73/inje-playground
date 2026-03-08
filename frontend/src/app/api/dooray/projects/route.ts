import { NextResponse } from "next/server";

/**
 * GET /api/dooray/projects
 * Dooray API는 사내 네트워크에서만 접근 가능하므로 브라우저에서 직접 호출합니다.
 * → dooray-client.ts (클라이언트 사이드)
 */
export async function GET() {
  return NextResponse.json(
    { error: "이 엔드포인트는 더 이상 사용되지 않습니다. 브라우저에서 직접 Dooray API를 호출하세요." },
    { status: 410 }
  );
}
