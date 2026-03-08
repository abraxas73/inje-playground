import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { nlmFetch } from "@/lib/nlm-service";

export async function GET(request: NextRequest) {
  const visible = request.nextUrl.searchParams.get("visible");

  try {
    const supabase = await createServerSupabase();

    let query = supabase
      .from("nlm_notebooks")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (visible === "true") {
      query = query.eq("is_visible", true);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ notebooks: data });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "노트북 목록 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description } = body;

    if (!title) {
      return NextResponse.json(
        { error: "title은 필수입니다." },
        { status: 400 }
      );
    }

    // Create notebook in nlm-service
    const nlmResult = await nlmFetch("/notebook", {
      method: "POST",
      body: JSON.stringify({ title, sources: [] }),
    });

    // Insert into Supabase
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("nlm_notebooks")
      .insert({
        nlm_notebook_id: nlmResult.notebook_id,
        title,
        description: description || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ notebook: data }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "노트북 생성에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
