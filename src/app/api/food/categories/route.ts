import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();

  const { searchParams } = new URL(request.url);
  const groupCode = searchParams.get("category_group_code") || "FD6";

  const { data, error } = await supabase
    .from("food_categories")
    .select("sub_category")
    .eq("category_group_code", groupCode)
    .order("sub_category");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data.map((d) => d.sub_category));
}
