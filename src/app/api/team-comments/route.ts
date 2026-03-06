import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
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
