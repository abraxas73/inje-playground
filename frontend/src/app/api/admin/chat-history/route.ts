import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

/** GET /api/admin/chat-history — 전체 사용자 질의/응답 조회 (admin only) */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // Check admin role
    const { data: caller } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (caller?.role !== "admin") {
      return NextResponse.json(
        { error: "관리자 권한이 필요합니다." },
        { status: 403 }
      );
    }

    // Query params
    const searchParams = request.nextUrl.searchParams;
    const notebookId = searchParams.get("notebookId");
    const userEmail = searchParams.get("userEmail");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    const offset = (page - 1) * pageSize;

    // Build query - only user messages (질의만)
    let query = supabase
      .from("nlm_chat_messages")
      .select("*", { count: "exact" })
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (notebookId) {
      query = query.eq("notebook_id", notebookId);
    }
    if (userEmail) {
      query = query.ilike("user_email", `%${userEmail}%`);
    }

    const { data: questions, error: questionsError, count } = await query;

    if (questionsError) {
      return NextResponse.json(
        { error: questionsError.message },
        { status: 500 }
      );
    }

    // For each question, fetch the corresponding assistant response
    const questionIds = (questions || []).map((q) => ({
      notebook_id: q.notebook_id,
      conversation_id: q.conversation_id,
      created_at: q.created_at,
    }));

    let answers: Record<string, typeof questions> = {};

    if (questions && questions.length > 0) {
      // Get assistant messages that follow each user message
      const conversationIds = [
        ...new Set(questions.map((q) => q.conversation_id).filter(Boolean)),
      ];

      if (conversationIds.length > 0) {
        const { data: assistantMessages } = await supabase
          .from("nlm_chat_messages")
          .select("*")
          .eq("role", "assistant")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: true });

        // Group by conversation_id for matching
        if (assistantMessages) {
          for (const msg of assistantMessages) {
            const key = msg.conversation_id || "";
            if (!answers[key]) answers[key] = [];
            answers[key].push(msg);
          }
        }
      }
    }

    // Pair questions with answers
    const paired = (questions || []).map((q) => {
      const convAnswers = answers[q.conversation_id || ""] || [];
      // Find the first assistant message after this user message
      const answer = convAnswers.find(
        (a) => new Date(a.created_at) > new Date(q.created_at)
      );
      return {
        question: q,
        answer: answer || null,
      };
    });

    // Fetch notebook titles for display
    const notebookIds = [
      ...new Set((questions || []).map((q) => q.notebook_id)),
    ];
    let notebooks: Record<string, string> = {};
    if (notebookIds.length > 0) {
      const { data: nbData } = await supabase
        .from("nlm_notebooks")
        .select("id, title")
        .in("id", notebookIds);
      if (nbData) {
        for (const nb of nbData) {
          notebooks[nb.id] = nb.title;
        }
      }
    }

    return NextResponse.json({
      items: paired,
      notebooks,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "채팅 기록 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
