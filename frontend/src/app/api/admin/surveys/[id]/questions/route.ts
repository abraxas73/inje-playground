import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { default_config_for } from "@/lib/survey";
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

/** GET /api/admin/surveys/[id]/questions — 문항 목록 (admin only) */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const { data, error } = await supabase
      .from("survey_questions")
      .select("*")
      .eq("survey_id", id)
      .order("order_index", { ascending: true });
    if (error) {
      console.error("[GET /api/admin/surveys/[id]/questions] fetch error:", error);
      return NextResponse.json({ error: "문항 조회에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    console.error("[GET /api/admin/surveys/[id]/questions] unexpected error:", err);
    return NextResponse.json({ error: "문항 조회에 실패했습니다." }, { status: 500 });
  }
}

/** POST /api/admin/surveys/[id]/questions — 문항 추가 (admin only) */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const type = body.type as QuestionType;
    if (!QUESTION_TYPES.includes(type)) {
      return NextResponse.json({ error: "유효하지 않은 문항 타입입니다." }, { status: 400 });
    }
    const title = String(body.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "title은 필수입니다." }, { status: 400 });
    }

    let orderIndex: number;
    if (body.order_index !== undefined) {
      orderIndex = Number(body.order_index);
    } else {
      const { data: last } = await supabase
        .from("survey_questions")
        .select("order_index")
        .eq("survey_id", id)
        .order("order_index", { ascending: false })
        .limit(1)
        .maybeSingle();
      orderIndex = last ? Number(last.order_index) + 1 : 0;
    }

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
    // default 위에 client config를 머지 → 누락 키 방지 + default 보장
    const config = { ...default_config_for(type), ...rawConfig };

    const { data, error } = await supabase
      .from("survey_questions")
      .insert({
        survey_id: id,
        type,
        title,
        section: body.section ? String(body.section) : null,
        description: body.description ? String(body.description) : null,
        required: body.required === true,
        config,
        order_index: orderIndex,
      })
      .select()
      .single();
    if (error) {
      console.error("[POST /api/admin/surveys/[id]/questions] insert error:", error);
      return NextResponse.json({ error: "문항 추가에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[POST /api/admin/surveys/[id]/questions] unexpected error:", err);
    return NextResponse.json({ error: "문항 추가에 실패했습니다." }, { status: 500 });
  }
}

/** PUT /api/admin/surveys/[id]/questions — 일괄 reorder/section 재배치 (admin only) */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const items = Array.isArray(body.items) ? body.items : [];
    const nowIso = new Date().toISOString();

    for (const it of items) {
      const updates: Record<string, unknown> = {
        order_index: Number(it.order_index),
        updated_at: nowIso,
      };
      if (it.section !== undefined) {
        updates.section = it.section ? String(it.section) : null;
      }
      const { error } = await supabase
        .from("survey_questions")
        .update(updates)
        .eq("id", it.id)
        .eq("survey_id", id); // scoped to this survey only
      if (error) {
        console.error("[PUT /api/admin/surveys/[id]/questions] update error:", error);
        return NextResponse.json({ error: "문항 순서 변경에 실패했습니다." }, { status: 500 });
      }
    }

    const { data, error } = await supabase
      .from("survey_questions")
      .select("*")
      .eq("survey_id", id)
      .order("order_index", { ascending: true });
    if (error) {
      console.error("[PUT /api/admin/surveys/[id]/questions] refetch error:", error);
      return NextResponse.json({ error: "문항 순서 변경에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    console.error("[PUT /api/admin/surveys/[id]/questions] unexpected error:", err);
    return NextResponse.json({ error: "문항 순서 변경에 실패했습니다." }, { status: 500 });
  }
}
