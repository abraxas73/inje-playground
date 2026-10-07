import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { GRAPH_BASE } from "@/lib/teams-graph";

export const runtime = "nodejs";

/** 현재 연결된 Microsoft 계정 사진. 토큰과 사진은 공유 캐시에 저장하지 않는다. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const reply = (photo: string | null) => NextResponse.json({ photo }, { headers: { "Cache-Control": "private, no-store" } });
  try {
    const token = await graphTokenForRoute(auth.admin, auth.userId);
    if (!token.ok) return reply(null);
    const res = await fetch(`${GRAPH_BASE}/me/photos/96x96/$value`, {
      headers: { Authorization: `Bearer ${token.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return reply(null);
    const type = res.headers.get("content-type")?.split(";")[0].trim();
    if (type !== "image/jpeg" && type !== "image/png") return reply(null);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > 256_000) return reply(null);
    return reply(bytes.toString("base64"));
  } catch {
    // 사진 없음·권한 만료·통신 장애는 기본 아바타로 처리한다.
    return reply(null);
  }
}
