import { describe, it, expect } from "vitest";
import {
  CSV_BOM, escapeCsvField, buildRawCsv, buildAggregateCsv, combineCsvSections,
} from "@/lib/survey-csv";
import type { SurveyQuestion, SurveyResultSummary } from "@/types/survey";

const baseQ = (over: Partial<SurveyQuestion>): SurveyQuestion => ({
  id: over.id ?? "q", survey_id: "s", section: over.section ?? "S1", order_index: over.order_index ?? 0,
  type: over.type ?? "single_choice", title: over.title ?? "Q", description: null, required: true,
  config: over.config ?? {}, created_at: "", updated_at: "", ...over,
});

const questions: SurveyQuestion[] = [
  baseQ({ id: "q1", order_index: 0, type: "single_choice", title: "직무",
    config: { options: [{ value: "dev", label: "개발" }, { value: "pm", label: "기획" }] } }),
  baseQ({ id: "q2", order_index: 1, type: "multi_choice", title: "도구",
    config: { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } }),
  baseQ({ id: "q3", order_index: 2, type: "pre_post_scale", title: "생산성", config: { min: 1, max: 5 } }),
];
const rawInput = {
  questions,
  responses: [{
    id: "r1", submitted_at: "2026-06-26T00:00:00Z", is_complete: true,
    respondent_user_id: "u1", respondent_hash: null,
    answers: {
      q1: { value_text: "dev", value_number: null, value_json: null },
      q2: { value_text: null, value_number: null, value_json: ["a"] },
      q3: { value_text: null, value_number: null, value_json: { before: 2, after: 4 } },
    },
  }],
  includeIdentity: false,
};
const aggSummary: SurveyResultSummary = {
  survey_id: "s", total_responses: 10, complete_rate: 100, avg_duration_sec: 300,
  segments_applied: [],
  questions: [{
    question_id: "q3", section: "S1", order_index: 0, type: "scale", title: "지지도", n: 10, masked: false,
    stats: { n: 10, mean: 4.2, median: 4, sd: 0.6, min: 3, max: 5, distribution: [], top_box_pct: 70 },
  }] as unknown as SurveyResultSummary["questions"],
};

describe("escapeCsvField", () => {
  it("쉼표·따옴표·개행 이스케이프", () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvField("line\nbreak")).toBe('"line\nbreak"');
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(5)).toBe("5");
  });
});

describe("buildRawCsv", () => {
  it("BOM + CRLF + 식별정보 제외 + 타입별 직렬화", () => {
    const csv = buildRawCsv(rawInput);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).not.toContain("respondent_user_id");
    const header = csv.replace(CSV_BOM, "").split("\r\n")[0];
    expect(header).toContain("직무");
    expect(header).toContain("도구::A");
    expect(header).toContain("도구::B");
    expect(header).toContain("생산성_before");
    expect(header).toContain("생산성_after");
    expect(header).toContain("생산성_delta");
    const row = csv.replace(CSV_BOM, "").split("\r\n")[1];
    expect(row).toContain("개발");   // single → label
    expect(row).toContain("1");      // multi A=1
    expect(row).toContain("0");      // multi B=0
    expect(row).toContain("2");      // before
    expect(row).toContain("4");      // after
  });
  it("includeIdentity=true면 식별 컬럼 포함", () => {
    const csv = buildRawCsv({ ...rawInput, includeIdentity: true });
    expect(csv).toContain("respondent_user_id");
  });
});

describe("buildAggregateCsv", () => {
  it("문항별 요약 1행 + 헤더", () => {
    const csv = buildAggregateCsv(aggSummary);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("지지도");
    expect(csv).toContain("4.2");
    expect(csv).toContain("70");
  });
});

describe("combineCsvSections", () => {
  it("BOM 1회 + 섹션 제목 + 두 블록 포함", () => {
    const raw = buildRawCsv(rawInput);
    const agg = buildAggregateCsv(aggSummary);
    const combined = combineCsvSections([
      { title: "원본 응답", csv: raw },
      { title: "집계 요약", csv: agg },
    ]);
    expect(combined.startsWith(CSV_BOM)).toBe(true);
    expect(combined.split(CSV_BOM).length - 1).toBe(1); // BOM 정확히 1회
    expect(combined).toContain("원본 응답");
    expect(combined).toContain("집계 요약");
    expect(combined).toContain("직무");
    expect(combined).toContain("지지도");
  });
});
