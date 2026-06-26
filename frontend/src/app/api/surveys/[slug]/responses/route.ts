import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { Survey, SubmitResponsePayload } from "@/types/survey";

/** POST /api/surveys/[slug]/responses — submit_survey_response RPC */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const supabase = await createServerSupabase();

    const { data: survey, error: sError } = await supabase
      .from("surveys")
      .select("id, access_mode, status")
      .eq("slug", slug)
      .maybeSingle<Pick<Survey, "id" | "access_mode" | "status">>();

    if (sError) {
      console.error("[survey/responses] survey lookup error:", sError);
      return NextResponse.json({ error: "제출에 실패했습니다." }, { status: 500 });
    }
    if (!survey) {
      return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 410 });
    }

    let payload: SubmitResponsePayload;
    try {
      payload = (await request.json()) as SubmitResponsePayload;
    } catch {
      return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
    }
    if (!payload || !Array.isArray(payload.answers)) {
      return NextResponse.json({ error: "answers 필드가 필요합니다." }, { status: 400 });
    }

    const { data: responseId, error } = await supabase.rpc("submit_survey_response", {
      p_survey_id: survey.id,
      p_answers: payload.answers,
      p_meta: payload.meta ?? {},
      p_respondent_hash: payload.respondent_hash ?? null,
    });

    if (error) {
      const msg = error.message || "";
      if (msg.includes("auth_required")) {
        return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
      }
      if (msg.includes("already_submitted")) {
        return NextResponse.json({ error: "이미 제출한 설문입니다." }, { status: 409 });
      }
      if (msg.includes("survey_not_open")) {
        return NextResponse.json({ error: "현재 응답할 수 없는 설문입니다." }, { status: 409 });
      }
      console.error("[survey/responses] RPC error:", msg);
      return NextResponse.json({ error: "제출에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ response_id: responseId as string });
  } catch (err) {
    console.error("[survey/responses] Unexpected error:", err);
    return NextResponse.json({ error: "제출에 실패했습니다." }, { status: 500 });
  }
}
