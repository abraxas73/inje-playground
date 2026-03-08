import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("ladder_sessions")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const body = await request.json();
  const { title, participants, results, bridges, bridgeDensity, mappings } = body;

  const { data, error } = await supabase
    .from("ladder_sessions")
    .insert({
      title: title || null,
      participants,
      results,
      bridges,
      bridge_density: bridgeDensity,
      mappings,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

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
    .from("ladder_sessions")
    .update(updates)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
