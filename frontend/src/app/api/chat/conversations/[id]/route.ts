import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { supabaseChatStore } from "@/lib/chat/store";
import { deleteAttachmentObjects } from "@/lib/chat/attachments";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
const NOT_FOUND = () => NextResponse.json({ error: "대화를 찾지 못했습니다." }, { status: 404 });

async function own(ctx: Ctx) {
  const r = await requireUser();
  if (!r.ok) return { ok: false, response: r.response } as const;
  const { id } = await ctx.params;
  const conv = await supabaseChatStore(r.admin).get(r.userId, id);
  if (!conv) return { ok: false, response: NOT_FOUND() } as const;
  return { ok: true, r, conv } as const;
}

/** GET — 대화 본문(메시지·도구 호출 요약). 도구 결과 원문은 저장돼 있지 않다. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const o = await own(ctx);
  if (!o.ok) return o.response;
  const messages = await supabaseChatStore(o.r.admin).messages(o.conv.id);
  const ids = messages.map((x) => x.id);
  const { data: toolCalls, error } = ids.length ? await o.r.admin.from("chat_tool_calls").select("message_id,tool_use_id,tool,location,status,summary").in("message_id", ids) : { data: [], error: null };
  if (error) return NextResponse.json({ error: "대화를 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ conversation: o.conv, messages, toolCalls: toolCalls ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

/** PATCH — 이름 바꾸기 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const o = await own(ctx);
  if (!o.ok) return o.response;
  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 80) return NextResponse.json({ error: "이름은 1~80자로 입력하세요." }, { status: 400 });
  const { error } = await o.r.admin.from("chat_conversations").update({ title }).eq("id", o.conv.id).eq("user_id", o.r.userId);
  if (error) return NextResponse.json({ error: "이름을 바꾸지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE — 즉시 삭제(첨부 객체 포함). 감사 로그·사용량은 남는다. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const o = await own(ctx);
  if (!o.ok) return o.response;
  const { data: atts } = await o.r.admin.from("chat_attachments").select("storage_path").eq("conversation_id", o.conv.id);
  await deleteAttachmentObjects(o.r.admin, (atts ?? []) as Array<{ storage_path: string }>);
  await o.r.admin.from("chat_attachments").delete().eq("conversation_id", o.conv.id);
  const { error } = await o.r.admin.from("chat_conversations").delete().eq("id", o.conv.id).eq("user_id", o.r.userId);
  if (error) return NextResponse.json({ error: "삭제하지 못했습니다." }, { status: 500 });
  await logAudit(o.r.admin, req, { userId: o.r.userId, action: "대화 삭제", category: "assistant", detail: {} });
  return NextResponse.json({ ok: true });
}
