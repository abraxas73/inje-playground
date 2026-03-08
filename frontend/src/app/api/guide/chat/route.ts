import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { nlmFetch } from "@/lib/nlm-service";

const DOORAY_API_BASE = "https://api.dooray.com";

/** Dooray 1:1 메시지로 가이드 Q&A 결과 전송 */
async function sendGuideDM(
  token: string,
  memberId: string,
  question: string,
  answer: string
) {
  const text = [
    `📋 **가이드 Q&A 답변 알림**`,
    ``,
    `❓ **질문**: ${question}`,
    ``,
    `💡 **답변**:`,
    answer.length > 500 ? answer.slice(0, 500) + "…" : answer,
  ].join("\n");

  try {
    await fetch(`${DOORAY_API_BASE}/messenger/v1/channels/direct-send`, {
      method: "POST",
      headers: {
        Authorization: `dooray-api ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        organizationMemberId: memberId,
      }),
    });
  } catch {
    // DM 전송 실패는 무시 (채팅 응답에 영향 없음)
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { notebookId, question, conversationId } = body;

    if (!notebookId || !question) {
      return NextResponse.json(
        { error: "notebookId와 question은 필수입니다." },
        { status: 400 }
      );
    }

    // Lookup nlm_notebook_id from Supabase
    const { data: notebook, error: lookupError } = await supabase
      .from("nlm_notebooks")
      .select("nlm_notebook_id")
      .eq("id", notebookId)
      .single();

    if (lookupError || !notebook) {
      return NextResponse.json(
        { error: "노트북을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // Call nlm-service chat
    const result = await nlmFetch("/chat", {
      method: "POST",
      body: JSON.stringify({
        notebook_id: notebook.nlm_notebook_id,
        question,
        ...(conversationId && { conversation_id: conversationId }),
      }),
    });

    // Save user message
    await supabase.from("nlm_chat_messages").insert({
      notebook_id: notebookId,
      user_email: user.email,
      conversation_id: result.conversation_id,
      role: "user",
      content: question,
    });

    // Save assistant message
    await supabase.from("nlm_chat_messages").insert({
      notebook_id: notebookId,
      user_email: user.email,
      conversation_id: result.conversation_id,
      role: "assistant",
      content: result.answer,
      citations: result.references || null,
    });

    // Dooray 1:1 메시지 전송 (본인 인증된 사용자에게)
    // 비동기로 처리하여 채팅 응답에 지연 없음
    const { data: userSettings } = await supabase
      .from("user_settings")
      .select("key, value")
      .eq("user_id", user.id)
      .in("key", ["dooray_member_id", "dooray_token"]);

    const settingsMap: Record<string, string> = {};
    for (const row of userSettings || []) {
      settingsMap[row.key] = row.value;
    }

    // 시스템 토큰 fallback
    if (!settingsMap.dooray_token) {
      const { data: sysToken } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "dooray_token")
        .single();
      if (sysToken?.value) settingsMap.dooray_token = sysToken.value;
    }

    if (settingsMap.dooray_member_id && settingsMap.dooray_token) {
      // fire-and-forget: 응답을 기다리지 않음
      sendGuideDM(
        settingsMap.dooray_token,
        settingsMap.dooray_member_id,
        question,
        result.answer
      );
    }

    return NextResponse.json({
      answer: result.answer,
      conversationId: result.conversation_id,
      citations: result.references || [],
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "채팅 처리에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
