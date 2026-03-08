import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { nlmFetch } from "@/lib/nlm-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, is_visible, sort_order } = body;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (is_visible !== undefined) updates.is_visible = is_visible;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("nlm_notebooks")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { error: "노트북을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    return NextResponse.json({ notebook: data });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "노트북 수정에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();

    // Lookup nlm_notebook_id
    const { data: notebook, error: lookupError } = await supabase
      .from("nlm_notebooks")
      .select("nlm_notebook_id")
      .eq("id", id)
      .single();

    if (lookupError || !notebook) {
      return NextResponse.json(
        { error: "노트북을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // Delete from nlm-service
    await nlmFetch(`/notebook/${notebook.nlm_notebook_id}`, {
      method: "DELETE",
    });

    // Delete from Supabase (cascade deletes messages + sources)
    const { error: deleteError } = await supabase
      .from("nlm_notebooks")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "노트북 삭제에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
