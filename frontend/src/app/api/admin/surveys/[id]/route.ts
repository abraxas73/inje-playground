import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { SurveyStatus } from "@/types/survey";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const ALLOWED_STATUS_TRANSITIONS: Record<SurveyStatus, SurveyStatus[]> = {
  draft: ["draft", "open"],
  open: ["open", "closed"],
  closed: ["closed", "open"],
};

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

async function requireAdmin(
  supabase: SupabaseClient
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }),
    };
  }
  const { data: caller } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (caller?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}

/** GET /api/admin/surveys/[id] — 설문 + 문항 (admin only) */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const { data: survey, error } = await supabase
      .from("surveys")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[GET /api/admin/surveys/[id]] survey fetch error:", error);
      return NextResponse.json({ error: "설문 조회에 실패했습니다." }, { status: 500 });
    }
    if (!survey) {
      return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: questions, error: qErr } = await supabase
      .from("survey_questions")
      .select("*")
      .eq("survey_id", id)
      .order("order_index", { ascending: true });
    if (qErr) {
      console.error("[GET /api/admin/surveys/[id]] questions fetch error:", qErr);
      return NextResponse.json({ error: "문항 조회에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ...survey, questions: questions ?? [] });
  } catch (err) {
    console.error("[GET /api/admin/surveys/[id]] unexpected error:", err);
    return NextResponse.json({ error: "설문 조회에 실패했습니다." }, { status: 500 });
  }
}

/** PATCH /api/admin/surveys/[id] — 설문 메타/상태 수정 (admin only) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const { data: current, error: curErr } = await supabase
      .from("surveys")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (curErr) {
      console.error("[PATCH /api/admin/surveys/[id]] current fetch error:", curErr);
      return NextResponse.json({ error: "설문 조회에 실패했습니다." }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) updates.title = String(body.title);
    if (body.description !== undefined)
      updates.description = body.description ? String(body.description) : null;
    if (body.access_mode !== undefined) {
      if (body.access_mode !== "public" && body.access_mode !== "authenticated") {
        return NextResponse.json(
          { error: "access_mode은 'public' 또는 'authenticated'만 허용됩니다." },
          { status: 400 }
        );
      }
      updates.access_mode = body.access_mode;
    }
    if (body.is_anonymous !== undefined) updates.is_anonymous = body.is_anonymous === true;
    if (body.opens_at !== undefined) updates.opens_at = body.opens_at || null;
    if (body.closes_at !== undefined) updates.closes_at = body.closes_at || null;
    if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order);

    if (body.slug !== undefined) {
      const slug = String(body.slug).trim();
      if (!slug || !SLUG_RE.test(slug)) {
        return NextResponse.json(
          { error: "slug는 영소문자/숫자/하이픈만 가능합니다." },
          { status: 400 }
        );
      }
      if (slug !== current.slug) {
        const { data: dup } = await supabase
          .from("surveys")
          .select("id")
          .eq("slug", slug)
          .neq("id", id)
          .maybeSingle();
        if (dup) {
          return NextResponse.json({ error: "이미 사용 중인 slug입니다." }, { status: 409 });
        }
      }
      updates.slug = slug;
    }

    if (body.status !== undefined) {
      const next = body.status as SurveyStatus;
      const allowed = ALLOWED_STATUS_TRANSITIONS[current.status as SurveyStatus] ?? [];
      if (!allowed.includes(next)) {
        return NextResponse.json(
          { error: `'${current.status}' → '${next}' 상태 전이는 허용되지 않습니다.` },
          { status: 409 }
        );
      }
      updates.status = next;
    }

    const { data, error } = await supabase
      .from("surveys")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "이미 사용 중인 slug입니다." }, { status: 409 });
      }
      console.error("[PATCH /api/admin/surveys/[id]] update error:", error);
      return NextResponse.json({ error: "설문 수정에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[PATCH /api/admin/surveys/[id]] unexpected error:", err);
    return NextResponse.json({ error: "설문 수정에 실패했습니다." }, { status: 500 });
  }
}

/** DELETE /api/admin/surveys/[id] — 설문 삭제 (cascade, admin only) */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const { data: deleted, error } = await supabase
      .from("surveys")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      console.error("[DELETE /api/admin/surveys/[id]] delete error:", error);
      return NextResponse.json({ error: "설문 삭제에 실패했습니다." }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/admin/surveys/[id]] unexpected error:", err);
    return NextResponse.json({ error: "설문 삭제에 실패했습니다." }, { status: 500 });
  }
}
