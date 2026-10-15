import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { deleteAttachmentObjects } from "@/lib/chat/attachments";

export const runtime = "nodejs";
export const maxDuration = 60;
// 첨부 한 건이 객체 2개(원본·text.txt)라 400건 = 800경로 — 스토리지 remove 한 번 상한(1000) 안
const BATCH = 400;

/**
 * 보존 기간(expires_at)이 지난 대화를 지운다(메시지·도구 기록은 cascade, 첨부 행은 conversation_id가 null이 됨).
 * 이어서 하루 지난 고아 첨부(보내지 않은 업로드·지워진 대화의 첨부)의 버킷 객체와 행을 지운다. 한 번에 400건씩(오래된 순) — 남으면 다음 날 이어서.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || ""), expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: convs, error: e1 } = await admin.from("chat_conversations").select("id").lt("expires_at", new Date().toISOString()).limit(BATCH);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  const ids = (convs ?? []).map((c: { id: string }) => c.id);
  if (ids.length) {
    const { error } = await admin.from("chat_conversations").delete().in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: orphans, error: e2 } = await admin.from("chat_attachments").select("id,storage_path").is("conversation_id", null).lt("created_at", cutoff).order("created_at").limit(BATCH);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  const rows = (orphans ?? []) as Array<{ id: string; storage_path: string }>;
  let attachments = 0;
  // 객체 삭제가 실패하면 행을 남겨 다음 실행에서 다시 시도한다(행을 지우면 객체가 영구 고아가 된다).
  if (rows.length && (await deleteAttachmentObjects(admin, rows))) {
    const { error } = await admin.from("chat_attachments").delete().in("id", rows.map((r) => r.id));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    attachments = rows.length;
  }
  return NextResponse.json({ conversations: ids.length, attachments });
}
