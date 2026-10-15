import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { relayToolCall } from "@/lib/mcp/relay";
import { getConnectionStatus } from "@/lib/ms/connections";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/chat/status — 채팅 상단 연결 상태 띠. 데스크톱 앱은 중계 whoami로 직접 확인한다(앱이 없으면 클레임 시간 초과 10초). */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const [desktop, microsoft, atlassian] = await Promise.all([
    relayToolCall({ admin: r.admin }, r.userId, "whoami", {}).then((x) => !x.isError).catch(() => false),
    getConnectionStatus(r.admin, r.userId).then((s) => s.connected).catch(() => false),
    Promise.resolve(r.admin.from("jira_connections").select("user_id").eq("user_id", r.userId).maybeSingle()).then((x) => !!x.data).catch(() => false),
  ]);
  return NextResponse.json({ desktop, microsoft, atlassian }, { headers: { "Cache-Control": "no-store" } });
}
