import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

// 이력 조회 (삭제되지 않은 것만)
export async function GET() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("team_sessions")
    .select(`
      *,
      team_results (
        *,
        team_comments (*)
      )
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sort team_results by sort_order
  for (const session of data) {
    session.team_results?.sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order);
    for (const team of session.team_results || []) {
      team.team_comments?.sort((a: { created_at: string }, b: { created_at: string }) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }
  }

  return NextResponse.json(data);
}

// 팀 구성 저장
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const body = await request.json();
  const { title, participants, teamCount, cardHolderDistribution, teams } = body;

  // 1. Create session
  const { data: session, error: sessionError } = await supabase
    .from("team_sessions")
    .insert({
      title: title || null,
      participants,
      team_count: teamCount,
      card_holder_distribution: cardHolderDistribution,
    })
    .select()
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: sessionError?.message }, { status: 500 });
  }

  // 2. Create team results
  const teamRows = teams.map((team: { name: string; members: unknown[] }, index: number) => ({
    session_id: session.id,
    team_name: team.name,
    members: team.members,
    sort_order: index,
  }));

  const { error: teamsError } = await supabase
    .from("team_results")
    .insert(teamRows);

  if (teamsError) {
    return NextResponse.json({ error: teamsError.message }, { status: 500 });
  }

  return NextResponse.json({ id: session.id });
}

// 제목 수정 / 소프트 삭제
export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabase();
  const body = await request.json();
  const { id, title, delete: softDelete } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (softDelete) {
    updates.deleted_at = new Date().toISOString();
  } else if (title !== undefined) {
    updates.title = title || null;
  }

  const { error } = await supabase
    .from("team_sessions")
    .update(updates)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
