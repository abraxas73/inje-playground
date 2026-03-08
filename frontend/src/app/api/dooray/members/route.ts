import { NextResponse } from "next/server";

/**
 * GET /api/dooray/members
 * Dooray API는 사내 네트워크에서만 접근 가능하므로 브라우저에서 직접 호출합니다.
 * 이 라우트는 더 이상 사용되지 않습니다. → dooray-client.ts (클라이언트 사이드)
 * DB 캐시 저장은 POST /api/dooray/members/cache 사용
 */
export async function GET() {
  return NextResponse.json(
    { error: "이 엔드포인트는 더 이상 사용되지 않습니다. 브라우저에서 직접 Dooray API를 호출하세요." },
    { status: 410 }
  );
}
