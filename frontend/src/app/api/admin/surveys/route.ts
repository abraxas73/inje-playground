import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { SurveyAccessMode } from "@/types/survey";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** GET /api/admin/surveys — 설문 목록 + 응답 카운트 (admin only) */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const { data: caller } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (caller?.role !== "admin") {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const status = request.nextUrl.searchParams.get("status");

    let query = supabase
      .from("surveys")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (status) {
      query = query.eq("status", status);
    }

    const { data: surveys, error } = await query;
    if (error) {
      console.error("[admin/surveys GET] surveys query error:", error);
      return NextResponse.json({ error: "설문 목록 조회에 실패했습니다." }, { status: 500 });
    }

    const ids = (surveys ?? []).map((s) => s.id);
    const counts: Record<string, { response_count: number; complete_count: number }> = {};
    if (ids.length > 0) {
      const { data: responses, error: responsesError } = await supabase
        .from("survey_responses")
        .select("survey_id, is_complete")
        .in("survey_id", ids);
      if (responsesError) {
        console.error("[admin/surveys GET] responses query error:", responsesError);
        // non-fatal: return surveys without counts rather than failing
      }
      for (const r of responses ?? []) {
        const c =
          counts[r.survey_id] ??
          (counts[r.survey_id] = { response_count: 0, complete_count: 0 });
        c.response_count += 1;
        if (r.is_complete) c.complete_count += 1;
      }
    }

    const items = (surveys ?? []).map((s) => ({
      ...s,
      response_count: counts[s.id]?.response_count ?? 0,
      complete_count: counts[s.id]?.complete_count ?? 0,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[admin/surveys GET] unexpected error:", err);
    return NextResponse.json({ error: "설문 목록 조회에 실패했습니다." }, { status: 500 });
  }
}

/** POST /api/admin/surveys — 설문 생성 (admin only) */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const { data: caller } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (caller?.role !== "admin") {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const body = await request.json();
    const slug = String(body.slug ?? "").trim();
    const title = String(body.title ?? "").trim();
    const description: string | null = body.description ? String(body.description) : null;
    const accessMode: SurveyAccessMode =
      body.access_mode === "public" ? "public" : "authenticated";
    const isAnonymous: boolean = body.is_anonymous === true;

    if (!slug || !SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: "slug는 영소문자/숫자/하이픈만 가능하며 영숫자로 시작해야 합니다." },
        { status: 400 }
      );
    }
    if (!title) {
      return NextResponse.json({ error: "title은 필수입니다." }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("surveys")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "이미 사용 중인 slug입니다." }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("surveys")
      .insert({
        slug,
        title,
        description,
        access_mode: accessMode,
        is_anonymous: isAnonymous,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "이미 사용 중인 slug입니다." }, { status: 409 });
      }
      console.error("[admin/surveys POST] insert error:", error);
      return NextResponse.json({ error: "설문 생성에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[admin/surveys POST] unexpected error:", err);
    return NextResponse.json({ error: "설문 생성에 실패했습니다." }, { status: 500 });
  }
}
