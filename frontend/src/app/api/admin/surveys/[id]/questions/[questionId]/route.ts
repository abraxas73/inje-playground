import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { QuestionType } from "@/types/survey";

const QUESTION_TYPES: QuestionType[] = [
  "single_choice",
  "multi_choice",
  "scale",
  "nps",
  "number",
  "text",
  "textarea",
  "pre_post_scale",
];

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

async function requireAdmin(
  supabase: SupabaseClient
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
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
  return { ok: true };
}

/** PATCH /api/admin/surveys/[id]/questions/[questionId] — 문항 수정 (admin only) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  try {
    const { id, questionId } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) updates.title = String(body.title);
    if (body.type !== undefined) {
      const type = body.type as QuestionType;
      if (!QUESTION_TYPES.includes(type)) {
        return NextResponse.json({ error: "유효하지 않은 문항 타입입니다." }, { status: 400 });
      }
      updates.type = type;
    }
    if (body.section !== undefined)
      updates.section = body.section ? String(body.section) : null;
    if (body.description !== undefined)
      updates.description = body.description ? String(body.description) : null;
    if (body.required !== undefined) updates.required = body.required === true;
    if (body.config !== undefined) {
      const rawConfig =
        body.config && typeof body.config === "object" && !Array.isArray(body.config)
          ? (body.config as Record<string, unknown>)
          : {};
      // 최상위 키 snake_case 강제 — camelCase/대문자 포함 키 거부(분석 무결성)
      const badKeys = Object.keys(rawConfig).filter((k) => /[A-Z]/.test(k));
      if (badKeys.length > 0) {
        return NextResponse.json(
          { error: `config 키는 snake_case만 허용됩니다: ${badKeys.join(", ")}` },
          { status: 400 }
        );
      }
      updates.config = rawConfig;
    }
    if (body.order_index !== undefined) updates.order_index = Number(body.order_index);

    // 이중 scoping: survey_id + id — 다른 설문의 문항 수정 불가(IDOR 방지)
    const { data, error } = await supabase
      .from("survey_questions")
      .update(updates)
      .eq("id", questionId)
      .eq("survey_id", id)
      .select()
      .maybeSingle();
    if (error) {
      console.error(
        "[PATCH /api/admin/surveys/[id]/questions/[questionId]] update error:",
        error
      );
      return NextResponse.json({ error: "문항 수정에 실패했습니다." }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "문항을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error(
      "[PATCH /api/admin/surveys/[id]/questions/[questionId]] unexpected error:",
      err
    );
    return NextResponse.json({ error: "문항 수정에 실패했습니다." }, { status: 500 });
  }
}

/** DELETE /api/admin/surveys/[id]/questions/[questionId] — 문항 삭제 (admin only) */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  try {
    const { id, questionId } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    // 이중 scoping: survey_id + id — 다른 설문의 문항 삭제 불가(IDOR 방지)
    // .select("id") 로 삭제된 행 반환 → 빈 배열이면 404
    const { data: deleted, error } = await supabase
      .from("survey_questions")
      .delete()
      .eq("id", questionId)
      .eq("survey_id", id)
      .select("id");
    if (error) {
      console.error(
        "[DELETE /api/admin/surveys/[id]/questions/[questionId]] delete error:",
        error
      );
      return NextResponse.json({ error: "문항 삭제에 실패했습니다." }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: "문항을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[DELETE /api/admin/surveys/[id]/questions/[questionId]] unexpected error:",
      err
    );
    return NextResponse.json({ error: "문항 삭제에 실패했습니다." }, { status: 500 });
  }
}
