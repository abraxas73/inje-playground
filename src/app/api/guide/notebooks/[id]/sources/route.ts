import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { nlmFetch } from "@/lib/nlm-service";

async function getNotebook(supabase: Awaited<ReturnType<typeof createServerSupabase>>, id: string) {
  const { data, error } = await supabase
    .from("nlm_notebooks")
    .select("nlm_notebook_id")
    .eq("id", id)
    .single();

  if (error || !data) {
    return null;
  }
  return data;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();

    const notebook = await getNotebook(supabase, id);
    if (!notebook) {
      return NextResponse.json(
        { error: "노트북을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const result = await nlmFetch(
      `/notebook/${notebook.nlm_notebook_id}/sources`
    );

    return NextResponse.json({ sources: result.sources });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "소스 목록 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { type, title, content, url, fileName } = body;

    if (!type || !["text", "url", "file"].includes(type)) {
      return NextResponse.json(
        { error: "유효하지 않은 소스 타입입니다. (text, url, file)" },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabase();

    const notebook = await getNotebook(supabase, id);
    if (!notebook) {
      return NextResponse.json(
        { error: "노트북을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const nlmId = notebook.nlm_notebook_id;
    let result;

    switch (type) {
      case "text":
        result = await nlmFetch(`/notebook/${nlmId}/sources/add-text`, {
          method: "POST",
          body: JSON.stringify({ title, content }),
        });
        break;
      case "url":
        result = await nlmFetch(`/notebook/${nlmId}/sources/add-url`, {
          method: "POST",
          body: JSON.stringify({ url }),
        });
        break;
      case "file":
        result = await nlmFetch(
          `/notebook/${nlmId}/sources/add-file-from-url`,
          {
            method: "POST",
            body: JSON.stringify({ url, file_name: fileName }),
          }
        );
        break;
    }

    const source = result.source;

    const { error: insertError } = await supabase.from("nlm_sources").insert({
      notebook_id: id,
      nlm_source_id: source.id,
      title: source.title,
      source_type: type,
    });

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ source }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "소스 추가에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get("sourceId");

    if (!sourceId) {
      return NextResponse.json(
        { error: "sourceId 파라미터가 필요합니다." },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabase();

    const notebook = await getNotebook(supabase, id);
    if (!notebook) {
      return NextResponse.json(
        { error: "노트북을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // Delete from nlm-service
    await nlmFetch(
      `/notebook/${notebook.nlm_notebook_id}/sources/${sourceId}`,
      { method: "DELETE" }
    );

    // Delete from Supabase
    const { error: deleteError } = await supabase
      .from("nlm_sources")
      .delete()
      .eq("nlm_source_id", sourceId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "소스 삭제에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
