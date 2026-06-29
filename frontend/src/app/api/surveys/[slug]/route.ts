import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { Survey, SurveyQuestion } from "@/types/survey";

/** GET /api/surveys/[slug] — 공개 조회(access_mode 재확인) */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: survey, error } = await supabase
      .from("surveys")
      .select("id, slug, title, description, access_mode, status")
      .eq("slug", slug)
      .maybeSingle<Pick<Survey, "id" | "slug" | "title" | "description" | "access_mode" | "status">>();

    if (error) {
      console.error("[survey GET] 설문 조회 오류:", error);
      return NextResponse.json({ error: "설문 조회에 실패했습니다." }, { status: 500 });
    }
    if (!survey) {
      return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    }
    if (survey.status === "closed") {
      return NextResponse.json({ error: "마감된 설문입니다." }, { status: 410 });
    }
    if (survey.status !== "open") {
      return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    }
    if (survey.access_mode === "authenticated" && !user) {
      return NextResponse.json({ error: "로그인이 필요한 설문입니다." }, { status: 401 });
    }

    const { data: questions, error: qError } = await supabase
      .from("survey_questions")
      .select("*")
      .eq("survey_id", survey.id)
      .order("order_index", { ascending: true })
      .returns<SurveyQuestion[]>();

    if (qError) {
      console.error("[survey GET] 문항 조회 오류:", qError);
      return NextResponse.json({ error: "설문 조회에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ...survey, questions: questions ?? [] });
  } catch (err) {
    console.error("[survey GET] 예외:", err);
    return NextResponse.json({ error: "설문 조회에 실패했습니다." }, { status: 500 });
  }
}
