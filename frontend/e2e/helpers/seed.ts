/**
 * E2E 시드 헬퍼 — 분석 대시보드 테스트용 데이터 생성/정리.
 *
 * 서비스 롤 키(SUPABASE_SERVICE_ROLE_KEY)로 직접 DB에 삽입.
 * 반드시 afterAll 에서 cleanupSurvey() 로 정리할 것.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface SeededSurvey {
  surveyId: string;
  slug: string;
  roleQuestionId: string;
}

/**
 * 서비스 롤로 직접 시드:
 *  설문 1개 + 문항 2개(단일선택 segment + pre_post_scale) + 완료응답 6건
 *  - 직무: dev 4건 / pm 2건
 *  - 생산성: before=2, after=4 (Δ+2, 100%↑)
 */
export async function seedAnalyticsSurvey(): Promise<SeededSurvey> {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const slug = `e2e-analytics-${Date.now()}`;

  const { data: survey, error: sErr } = await admin
    .from("surveys")
    .insert({
      slug,
      title: "E2E 분석 설문",
      status: "open",
      access_mode: "authenticated",
      is_anonymous: true,
    })
    .select("id")
    .single();
  if (sErr) throw sErr;

  const { data: q1, error: q1Err } = await admin
    .from("survey_questions")
    .insert({
      survey_id: survey.id,
      section: "S0",
      order_index: 0,
      type: "single_choice",
      title: "직무",
      required: true,
      config: {
        segment: true,
        ordinal: false,
        options: [
          { value: "dev", label: "개발" },
          { value: "pm", label: "기획" },
        ],
      },
    })
    .select("id")
    .single();
  if (q1Err) throw q1Err;

  const { data: q2, error: q2Err } = await admin
    .from("survey_questions")
    .insert({
      survey_id: survey.id,
      section: "S1",
      order_index: 1,
      type: "pre_post_scale",
      title: "생산성",
      required: true,
      config: {
        min: 1,
        max: 5,
        analysis_metric: "pre_post_overall",
        target: 1,
      },
    })
    .select("id")
    .single();
  if (q2Err) throw q2Err;

  // 6건 응답 삽입: dev 4건 + pm 2건, 각각 before=2 / after=4
  for (let i = 0; i < 6; i++) {
    const { data: resp, error: respErr } = await admin
      .from("survey_responses")
      .insert({
        survey_id: survey.id,
        is_complete: true,
        submitted_at: new Date().toISOString(),
        meta: { duration_sec: 300 },
      })
      .select("id")
      .single();
    if (respErr) throw respErr;

    const { error: ansErr } = await admin.from("survey_answers").insert([
      { response_id: resp.id, question_id: q1.id, value_text: i < 4 ? "dev" : "pm" },
      { response_id: resp.id, question_id: q2.id, value_json: { before: 2, after: 4 } },
    ]);
    if (ansErr) throw ansErr;
  }

  return { surveyId: survey.id, slug, roleQuestionId: q1.id };
}

/** 시드 데이터 전체 삭제 (cascade 삭제 의존) */
export async function cleanupSurvey(surveyId: string): Promise<void> {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.from("surveys").delete().eq("id", surveyId);
  if (error) {
    // afterAll 정리 실패는 테스트를 깨뜨리지 않되, 잔존 데이터 추적용으로 로깅.
    console.error(`[seed] cleanupSurvey(${surveyId}) 실패:`, error.message);
  }
}
