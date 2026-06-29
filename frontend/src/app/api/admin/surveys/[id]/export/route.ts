import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  buildRawCsv,
  buildAggregateCsv,
  combineCsvSections,
  type RawExportResponse,
} from "@/lib/survey-csv";
import type { SurveyQuestion, SurveyResultSummary } from "@/types/survey";

export const runtime = "nodejs";

/** GET /api/admin/surveys/[id]/export — CSV 내보내기(admin only) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const { data: caller } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (caller?.role !== "admin") {
      return NextResponse.json(
        { error: "관리자 권한이 필요합니다." },
        { status: 403 }
      );
    }

    const sp = request.nextUrl.searchParams;
    const format = sp.get("format") ?? "csv";
    const scope = sp.get("scope") ?? "all";
    const includeIdentity = sp.get("includeIdentity") === "true";

    if (format === "xlsx") {
      return NextResponse.json(
        { error: "xlsx는 v1에서 지원하지 않습니다. format=csv를 사용하세요." },
        { status: 400 }
      );
    }

    if (!["raw", "aggregate", "all"].includes(scope)) {
      return NextResponse.json(
        { error: "scope는 raw, aggregate, all 중 하나여야 합니다." },
        { status: 400 }
      );
    }

    const { data: survey, error: sErr } = await supabase
      .from("surveys")
      .select("slug, title")
      .eq("id", id)
      .single();
    if (sErr || !survey) {
      return NextResponse.json(
        { error: "설문을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const { data: questions } = await supabase
      .from("survey_questions")
      .select("*")
      .eq("survey_id", id)
      .order("order_index");
    const qs = (questions ?? []) as SurveyQuestion[];

    let rawCsv: string | null = null;
    let aggCsv: string | null = null;

    if (scope === "raw" || scope === "all") {
      // 식별정보(PII)는 includeIdentity=true일 때만 DB에서 가져온다.
      const responseSelect = includeIdentity
        ? "id, submitted_at, is_complete, respondent_user_id, respondent_hash"
        : "id, submitted_at, is_complete";
      const { data: responses } = await supabase
        .from("survey_responses")
        .select(responseSelect)
        .eq("survey_id", id)
        .eq("is_complete", true)
        .order("submitted_at", { ascending: true });
      // 동적 select 문자열이라 PostgREST 타입 추론이 ParserError를 내므로 명시 타입으로 단언한다.
      const respRows = (responses ?? []) as unknown as Array<{
        id: string;
        submitted_at: string | null;
        is_complete: boolean;
        respondent_user_id?: string | null;
        respondent_hash?: string | null;
      }>;
      const respIds = respRows.map((r) => r.id);

      const answersByResp: Record<string, RawExportResponse["answers"]> = {};
      if (respIds.length > 0) {
        const { data: answers } = await supabase
          .from("survey_answers")
          .select("response_id, question_id, value_text, value_number, value_json")
          .in("response_id", respIds);
        for (const a of answers ?? []) {
          (answersByResp[a.response_id] ??= {})[a.question_id] = {
            value_text: a.value_text,
            value_number: a.value_number,
            value_json: a.value_json,
          };
        }
      }

      const exportResponses: RawExportResponse[] = respRows.map((r) => ({
        id: r.id,
        submitted_at: r.submitted_at,
        is_complete: r.is_complete,
        ...(includeIdentity
          ? {
              respondent_user_id: r.respondent_user_id ?? null,
              respondent_hash: r.respondent_hash ?? null,
            }
          : {}),
        answers: answersByResp[r.id] ?? {},
      }));

      rawCsv = buildRawCsv({
        questions: qs,
        responses: exportResponses,
        includeIdentity,
      });
    }

    if (scope === "aggregate" || scope === "all") {
      const { data: summary, error: aggErr } = await supabase.rpc(
        "get_survey_aggregate",
        { p_survey_id: id, p_segments: [] }
      );
      if (aggErr) {
        console.error("[export] get_survey_aggregate RPC error:", aggErr);
        return NextResponse.json(
          { error: "집계 조회에 실패했습니다." },
          { status: 500 }
        );
      }
      aggCsv = buildAggregateCsv(summary as SurveyResultSummary);
    }

    let body: string;
    if (scope === "all") {
      body = combineCsvSections([
        { title: "원본 응답", csv: rawCsv ?? "" },
        { title: "집계 요약", csv: aggCsv ?? "" },
      ]);
    } else if (scope === "aggregate") {
      body = aggCsv ?? "";
    } else {
      body = rawCsv ?? "";
    }

    const filename = `${survey.slug || "survey"}-${scope}.csv`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error("[export] Unexpected error:", err);
    return NextResponse.json(
      { error: "내보내기에 실패했습니다." },
      { status: 500 }
    );
  }
}
