import { NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { listMyGroupChats } from "@/lib/teams/chat";
import { graphErrorResponse } from "@/lib/teams/chat-route";

export const runtime = "nodejs";

/** GET /api/admin/teams/chats — 관리자가 참여한 그룹 채팅 목록(시스템 설정에서 대상 고르기용). 관리자 본인의 Microsoft 연결을 쓴다. */
export async function GET() {
  const a = await requireAdmin();
  if (!a.ok) return a.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const tok = await graphTokenForRoute(c.admin, a.userId);
  if (!tok.ok) return tok.response;
  try {
    return NextResponse.json({ chats: await listMyGroupChats(tok.token) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
