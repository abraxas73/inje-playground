import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";

export const runtime = "nodejs";
/** GET /api/chat/conversations — 내 대화 목록(저장 안 함 제외, 최신순). */
export async function GET(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));
  const { data, error } = await r.admin.from("chat_conversations").select("id,title,model,last_message_at").eq("user_id", r.userId).eq("ephemeral", false).order("last_message_at", { ascending: false }).limit(limit);
  if (error) return NextResponse.json({ error: "대화 목록을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ conversations: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
