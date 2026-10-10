import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/lib/mcp/protocol";

/** OAuth 보호 리소스 메타데이터(RFC 9728) — /api/mcp의 401 응답이 가리키는 문서. */
export async function GET() {
  return NextResponse.json(protectedResourceMetadata(), { headers: { "Cache-Control": "public, max-age=300" } });
}
