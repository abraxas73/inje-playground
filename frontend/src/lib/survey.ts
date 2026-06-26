import type {
  QuestionType,
  SurveyQuestion,
  QuestionConfig,
  AnswerValue,
  AnswerColumns,
  PrePostValue,
} from "@/types/survey";

// exclusive 옵션(단독 선택 강제) value 규칙 — 시드는 이 키를 사용한다.
const EXCLUSIVE_VALUES = new Set(["none", "dont_know"]);

export interface QuestionTypeMeta {
  type: QuestionType;
  label: string;
  description: string;
  icon: string;
  value_column: "value_text" | "value_number" | "value_json";
  supports_options: boolean;
  supports_other: boolean;
  is_numeric: boolean;
}

export const QUESTION_TYPE_META: Record<QuestionType, QuestionTypeMeta> = {
  single_choice: {
    type: "single_choice", label: "객관식 단일", description: "보기 중 하나 선택",
    icon: "CircleDot", value_column: "value_text", supports_options: true, supports_other: true, is_numeric: false,
  },
  multi_choice: {
    type: "multi_choice", label: "객관식 복수", description: "보기 중 복수 선택",
    icon: "ListChecks", value_column: "value_json", supports_options: true, supports_other: true, is_numeric: false,
  },
  scale: {
    type: "scale", label: "척도(Likert)", description: "1~5 등 척도 평가",
    icon: "SlidersHorizontal", value_column: "value_number", supports_options: false, supports_other: false, is_numeric: true,
  },
  nps: {
    type: "nps", label: "NPS(0~10)", description: "추천 의향 0~10",
    icon: "Gauge", value_column: "value_number", supports_options: false, supports_other: false, is_numeric: true,
  },
  number: {
    type: "number", label: "숫자", description: "수치 입력(단위)",
    icon: "Hash", value_column: "value_number", supports_options: false, supports_other: false, is_numeric: true,
  },
  text: {
    type: "text", label: "단문", description: "한 줄 텍스트",
    icon: "Type", value_column: "value_text", supports_options: false, supports_other: false, is_numeric: false,
  },
  textarea: {
    type: "textarea", label: "장문", description: "여러 줄 텍스트",
    icon: "AlignLeft", value_column: "value_text", supports_options: false, supports_other: false, is_numeric: false,
  },
  pre_post_scale: {
    type: "pre_post_scale", label: "도입 전/현재", description: "두 시점 척도 비교",
    icon: "GitCompareArrows", value_column: "value_json", supports_options: false, supports_other: false, is_numeric: false,
  },
};

export function default_config_for(type: QuestionType): QuestionConfig {
  switch (type) {
    case "single_choice":
    case "multi_choice":
      return { options: [], allow_other: false };
    case "scale":
      return { min: 1, max: 5, min_label: "매우 낮음", mid_label: "보통", max_label: "매우 높음" };
    case "nps":
      return { min: 0, max: 10 };
    case "number":
      return { min: 0, unit: "" };
    case "text":
      return { placeholder: "", max_length: 200 };
    case "textarea":
      return { placeholder: "", max_length: 2000 };
    case "pre_post_scale":
      return { min: 1, max: 5, min_label: "매우 낮음", mid_label: "보통", max_label: "매우 높음", before_label: "도입 전", after_label: "현재" };
  }
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

function isEmptyText(s: string): boolean {
  return s.trim().length === 0;
}

export function validateAnswer(question: SurveyQuestion, value: AnswerValue): ValidationResult {
  const cfg = question.config ?? {};
  const required = question.required;

  switch (value.type) {
    case "single_choice": {
      if (value.value === null || value.value === "") {
        return required ? { ok: false, error: "필수 응답 문항입니다." } : { ok: true };
      }
      const opts = cfg.options ?? [];
      const known = opts.some((o) => o.value === value.value);
      if (!known && !cfg.allow_other) {
        return { ok: false, error: "허용되지 않은 선택지입니다." };
      }
      return { ok: true };
    }
    case "multi_choice": {
      const vals = value.value;
      if (vals.length === 0) {
        return required ? { ok: false, error: "최소 1개 이상 선택해 주세요." } : { ok: true };
      }
      const opts = cfg.options ?? [];
      for (const v of vals) {
        if (!opts.some((o) => o.value === v) && !cfg.allow_other) {
          return { ok: false, error: "허용되지 않은 선택지가 포함되어 있습니다." };
        }
      }
      const exclusiveSelected = vals.filter((v) => EXCLUSIVE_VALUES.has(v));
      if (exclusiveSelected.length > 0 && vals.length > 1) {
        return { ok: false, error: "해당 보기는 단독으로만 선택할 수 있습니다." };
      }
      return { ok: true };
    }
    case "scale": {
      if (value.value === null) {
        return required ? { ok: false, error: "필수 응답 문항입니다." } : { ok: true };
      }
      const min = cfg.min ?? 1;
      const max = cfg.max ?? 5;
      if (value.value < min || value.value > max) {
        return { ok: false, error: `${min}~${max} 범위로 응답해 주세요.` };
      }
      return { ok: true };
    }
    case "nps": {
      if (value.value === null) {
        return required ? { ok: false, error: "필수 응답 문항입니다." } : { ok: true };
      }
      if (value.value < 0 || value.value > 10 || !Number.isInteger(value.value)) {
        return { ok: false, error: "0~10 사이 정수로 응답해 주세요." };
      }
      return { ok: true };
    }
    case "number": {
      if (value.value === null) {
        return required ? { ok: false, error: "필수 응답 문항입니다." } : { ok: true };
      }
      if (Number.isNaN(value.value)) {
        return { ok: false, error: "숫자를 입력해 주세요." };
      }
      const min = cfg.min;
      const max = cfg.max;
      if (typeof min === "number" && value.value < min) {
        return { ok: false, error: `${min} 이상 입력해 주세요.` };
      }
      if (typeof max === "number" && value.value > max) {
        return { ok: false, error: `${max} 이하로 입력해 주세요.` };
      }
      return { ok: true };
    }
    case "text":
    case "textarea": {
      if (isEmptyText(value.value)) {
        return required ? { ok: false, error: "필수 응답 문항입니다." } : { ok: true };
      }
      const maxLen = cfg.max_length;
      if (typeof maxLen === "number" && value.value.length > maxLen) {
        return { ok: false, error: `${maxLen}자 이내로 입력해 주세요.` };
      }
      return { ok: true };
    }
    case "pre_post_scale": {
      const { before, after } = value.value;
      if (before === null || after === null) {
        if (!required && before === null && after === null) return { ok: true };
        return { ok: false, error: "도입 전·현재 두 시점 모두 응답해 주세요." };
      }
      const min = cfg.min ?? 1;
      const max = cfg.max ?? 5;
      if (before < min || before > max || after < min || after > max) {
        return { ok: false, error: `${min}~${max} 범위로 응답해 주세요.` };
      }
      return { ok: true };
    }
  }
}

export function answerToColumns(question: SurveyQuestion, value: AnswerValue): AnswerColumns {
  const base = { question_id: question.id, value_text: null as string | null, value_number: null as number | null, value_json: null as unknown };
  switch (value.type) {
    case "single_choice":
      return { ...base, value_text: value.value && value.value !== "" ? value.value : null };
    case "multi_choice":
      return { ...base, value_json: value.value.length > 0 ? value.value : null };
    case "scale":
    case "nps":
    case "number":
      return { ...base, value_number: value.value };
    case "text":
    case "textarea":
      return { ...base, value_text: isEmptyText(value.value) ? null : value.value };
    case "pre_post_scale": {
      const { before, after } = value.value;
      if (before === null && after === null) return { ...base };
      return { ...base, value_json: { before, after } };
    }
  }
}

export function columnsToAnswer(
  question: SurveyQuestion,
  columns: Pick<AnswerColumns, "value_text" | "value_number" | "value_json">,
): AnswerValue {
  switch (question.type) {
    case "single_choice":
      return { type: "single_choice", value: columns.value_text ?? null };
    case "multi_choice":
      return { type: "multi_choice", value: Array.isArray(columns.value_json) ? (columns.value_json as string[]) : [] };
    case "scale":
      return { type: "scale", value: columns.value_number ?? null };
    case "nps":
      return { type: "nps", value: columns.value_number ?? null };
    case "number":
      return { type: "number", value: columns.value_number ?? null };
    case "text":
      return { type: "text", value: columns.value_text ?? "" };
    case "textarea":
      return { type: "textarea", value: columns.value_text ?? "" };
    case "pre_post_scale": {
      const j = (columns.value_json ?? {}) as Partial<PrePostValue>;
      return { type: "pre_post_scale", value: { before: j.before ?? null, after: j.after ?? null } };
    }
  }
}

export function emptyAnswer(question: SurveyQuestion): AnswerValue {
  switch (question.type) {
    case "single_choice":
      return { type: "single_choice", value: null };
    case "multi_choice":
      return { type: "multi_choice", value: [] };
    case "scale":
      return { type: "scale", value: null };
    case "nps":
      return { type: "nps", value: null };
    case "number":
      return { type: "number", value: null };
    case "text":
      return { type: "text", value: "" };
    case "textarea":
      return { type: "textarea", value: "" };
    case "pre_post_scale":
      return { type: "pre_post_scale", value: { before: null, after: null } };
  }
}
