import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

// 참석 여부 토글
export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { teamResultId, memberName, attended } = await request.json();

  if (!teamResultId || !memberName || typeof attended !== "boolean") {
    return NextResponse.json({ error: "teamResultId, memberName, attended are required" }, { status: 400 });
  }

  // 현재 attendance 조회
  const { data, error: fetchError } = await supabase
    .from("team_results")
    .select("attendance")
    .eq("id", teamResultId)
    .single();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const attendance = (data?.attendance as Record<string, boolean>) || {};
  attendance[memberName] = attended;

  const { error } = await supabase
    .from("team_results")
    .update({ attendance })
    .eq("id", teamResultId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
