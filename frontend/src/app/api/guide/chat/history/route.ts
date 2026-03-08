import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
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

    const notebookId = request.nextUrl.searchParams.get("notebookId");
    if (!notebookId) {
      return NextResponse.json(
        { error: "notebookId는 필수입니다." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("nlm_chat_messages")
      .select("*")
      .eq("notebook_id", notebookId)
      .eq("user_email", user.email)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages: data });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "채팅 기록 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
