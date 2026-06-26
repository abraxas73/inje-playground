import { describe, it, expect } from "vitest";
import {
  validateAnswer,
  answerToColumns,
  columnsToAnswer,
  emptyAnswer,
  default_config_for,
  QUESTION_TYPE_META,
} from "@/lib/survey";
import type { SurveyQuestion } from "@/types/survey";

function q(partial: Partial<SurveyQuestion> & Pick<SurveyQuestion, "type">): SurveyQuestion {
  return {
    id: "q1",
    survey_id: "s1",
    section: "S0",
    order_index: 0,
    title: "문항",
    description: null,
    required: true,
    config: {},
    created_at: "2026-06-26T00:00:00Z",
    updated_at: "2026-06-26T00:00:00Z",
    ...partial,
  };
}

describe("QUESTION_TYPE_META", () => {
  it("8종 모두 정의", () => {
    const keys = Object.keys(QUESTION_TYPE_META);
    expect(keys.sort()).toEqual(
      ["multi_choice", "nps", "number", "pre_post_scale", "scale", "single_choice", "text", "textarea"].sort(),
    );
  });
  it("value_column 매핑이 저장 컨벤션과 일치", () => {
    expect(QUESTION_TYPE_META.single_choice.value_column).toBe("value_text");
    expect(QUESTION_TYPE_META.multi_choice.value_column).toBe("value_json");
    expect(QUESTION_TYPE_META.scale.value_column).toBe("value_number");
    expect(QUESTION_TYPE_META.pre_post_scale.value_column).toBe("value_json");
  });
});

describe("default_config_for", () => {
  it("scale 기본 1~5", () => {
    const c = default_config_for("scale");
    expect(c.min).toBe(1);
    expect(c.max).toBe(5);
  });
  it("pre_post_scale 기본 라벨", () => {
    const c = default_config_for("pre_post_scale");
    expect(c.before_label).toBe("도입 전");
    expect(c.after_label).toBe("현재");
  });
  it("single_choice 빈 옵션 배열", () => {
    expect(default_config_for("single_choice").options).toEqual([]);
  });
});

describe("validateAnswer — required", () => {
  it("single_choice 미선택 실패", () => {
    const r = validateAnswer(
      q({ type: "single_choice", config: { options: [{ value: "a", label: "A" }] } }),
      { type: "single_choice", value: null },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("필수");
  });
  it("선택형 required=false 미선택 통과", () => {
    const r = validateAnswer(
      q({ type: "single_choice", required: false, config: { options: [{ value: "a", label: "A" }] } }),
      { type: "single_choice", value: null },
    );
    expect(r.ok).toBe(true);
  });
});

describe("validateAnswer — single_choice", () => {
  it("옵션 외 값 실패", () => {
    const r = validateAnswer(
      q({ type: "single_choice", config: { options: [{ value: "a", label: "A" }] } }),
      { type: "single_choice", value: "x" },
    );
    expect(r.ok).toBe(false);
  });
  it("유효 옵션 통과", () => {
    const r = validateAnswer(
      q({ type: "single_choice", config: { options: [{ value: "a", label: "A" }] } }),
      { type: "single_choice", value: "a" },
    );
    expect(r.ok).toBe(true);
  });
});

describe("validateAnswer — multi_choice exclusive", () => {
  const mq = q({
    type: "multi_choice",
    config: { options: [{ value: "none", label: "없음" }, { value: "a", label: "A" }, { value: "b", label: "B" }] },
  });
  it("none 단독 통과", () => {
    expect(validateAnswer(mq, { type: "multi_choice", value: ["none"] }).ok).toBe(true);
  });
  it("none + 다른 보기 동시 선택 실패", () => {
    const r = validateAnswer(mq, { type: "multi_choice", value: ["none", "a"] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("단독");
  });
  it("required 미선택 실패", () => {
    expect(validateAnswer(mq, { type: "multi_choice", value: [] }).ok).toBe(false);
  });
});

describe("validateAnswer — scale / nps / number", () => {
  it("scale 범위 밖 실패", () => {
    const r = validateAnswer(q({ type: "scale", config: { min: 1, max: 5 } }), { type: "scale", value: 6 });
    expect(r.ok).toBe(false);
  });
  it("nps 0~10 경계 통과", () => {
    expect(validateAnswer(q({ type: "nps" }), { type: "nps", value: 0 }).ok).toBe(true);
    expect(validateAnswer(q({ type: "nps" }), { type: "nps", value: 10 }).ok).toBe(true);
  });
  it("nps 11 실패", () => {
    expect(validateAnswer(q({ type: "nps" }), { type: "nps", value: 11 }).ok).toBe(false);
  });
  it("number min 미만 실패", () => {
    const r = validateAnswer(q({ type: "number", config: { min: 0 } }), { type: "number", value: -1 });
    expect(r.ok).toBe(false);
  });
  it("number 0 통과", () => {
    expect(validateAnswer(q({ type: "number", config: { min: 0 } }), { type: "number", value: 0 }).ok).toBe(true);
  });
});

describe("validateAnswer — textarea max_length", () => {
  it("초과 실패", () => {
    const r = validateAnswer(
      q({ type: "textarea", required: false, config: { max_length: 3 } }),
      { type: "textarea", value: "abcd" },
    );
    expect(r.ok).toBe(false);
  });
});

describe("validateAnswer — pre_post_scale", () => {
  const pq = q({ type: "pre_post_scale", config: { min: 1, max: 5 } });
  it("both 존재 + 범위 내 통과", () => {
    expect(validateAnswer(pq, { type: "pre_post_scale", value: { before: 2, after: 4 } }).ok).toBe(true);
  });
  it("after 누락 실패", () => {
    const r = validateAnswer(pq, { type: "pre_post_scale", value: { before: 2, after: null } });
    expect(r.ok).toBe(false);
  });
  it("before 범위 밖 실패", () => {
    const r = validateAnswer(pq, { type: "pre_post_scale", value: { before: 0, after: 4 } });
    expect(r.ok).toBe(false);
  });
});

describe("answerToColumns — 저장 컨벤션 §3.1", () => {
  it("single_choice → value_text", () => {
    expect(answerToColumns(q({ type: "single_choice" }), { type: "single_choice", value: "a" })).toEqual({
      question_id: "q1", value_text: "a", value_number: null, value_json: null,
    });
  });
  it("multi_choice → value_json 배열", () => {
    expect(answerToColumns(q({ type: "multi_choice" }), { type: "multi_choice", value: ["a", "c"] })).toEqual({
      question_id: "q1", value_text: null, value_number: null, value_json: ["a", "c"],
    });
  });
  it("scale → value_number", () => {
    expect(answerToColumns(q({ type: "scale" }), { type: "scale", value: 4 })).toEqual({
      question_id: "q1", value_text: null, value_number: 4, value_json: null,
    });
  });
  it("nps → value_number", () => {
    expect(answerToColumns(q({ type: "nps" }), { type: "nps", value: 9 }).value_number).toBe(9);
  });
  it("text → value_text", () => {
    expect(answerToColumns(q({ type: "text" }), { type: "text", value: "hi" }).value_text).toBe("hi");
  });
  it("pre_post_scale → value_json {before,after}", () => {
    expect(answerToColumns(q({ type: "pre_post_scale" }), { type: "pre_post_scale", value: { before: 2, after: 5 } })).toEqual({
      question_id: "q1", value_text: null, value_number: null, value_json: { before: 2, after: 5 },
    });
  });
  it("빈 값은 null 컬럼", () => {
    expect(answerToColumns(q({ type: "single_choice" }), { type: "single_choice", value: null })).toEqual({
      question_id: "q1", value_text: null, value_number: null, value_json: null,
    });
    expect(answerToColumns(q({ type: "text" }), { type: "text", value: "" }).value_text).toBe(null);
  });
});

describe("columnsToAnswer / emptyAnswer 왕복", () => {
  it("single_choice 왕복", () => {
    const a = answerToColumns(q({ type: "single_choice" }), { type: "single_choice", value: "a" });
    expect(columnsToAnswer(q({ type: "single_choice" }), a)).toEqual({ type: "single_choice", value: "a" });
  });
  it("pre_post_scale 왕복", () => {
    const v = { type: "pre_post_scale" as const, value: { before: 1, after: 3 } };
    const a = answerToColumns(q({ type: "pre_post_scale" }), v);
    expect(columnsToAnswer(q({ type: "pre_post_scale" }), a)).toEqual(v);
  });
  it("emptyAnswer 타입별 초기값", () => {
    expect(emptyAnswer(q({ type: "multi_choice" }))).toEqual({ type: "multi_choice", value: [] });
    expect(emptyAnswer(q({ type: "pre_post_scale" }))).toEqual({ type: "pre_post_scale", value: { before: null, after: null } });
    expect(emptyAnswer(q({ type: "text" }))).toEqual({ type: "text", value: "" });
  });
});
