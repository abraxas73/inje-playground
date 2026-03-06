import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

// 코멘트 추가
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { teamResultId, author, content } = await request.json();

  if (!teamResultId || !content) {
    return NextResponse.json({ error: "teamResultId and content are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("team_comments")
    .insert({
      team_result_id: teamResultId,
      author: author || "익명",
      content,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// 코멘트 수정
export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { id, content } = await request.json();

  if (!id || !content) {
    return NextResponse.json({ error: "id and content are required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("team_comments")
    .update({ content })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// 코멘트 삭제
export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("team_comments")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
