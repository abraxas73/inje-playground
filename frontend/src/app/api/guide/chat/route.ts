import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { nlmFetch } from "@/lib/nlm-service";

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
