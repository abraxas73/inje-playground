import { NextResponse } from "next/server";

/** GET /api/dooray/projects — deprecated, 브라우저에서 직접 호출로 전환됨 */
export async function GET() {
  return NextResponse.json(
    { error: "브라우저에서 직접 Dooray API를 호출합니다. Chrome 확장을 확인하세요." },
    { status: 410 }
  );
}
