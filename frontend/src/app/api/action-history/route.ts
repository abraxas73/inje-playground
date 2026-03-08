import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const body = await request.json();
  const { action, category, detail } = body;

  if (!action || !category) {
    return NextResponse.json({ error: "action and category are required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("action_history")
    .insert({
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      action,
      category,
      detail: detail ?? {},
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "100");

  const { data, error } = await supabase
    .from("action_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
