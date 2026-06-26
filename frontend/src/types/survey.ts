// =====================================================================
// 설문 시스템 타입 계약 (스펙 §4.5). snake_case 통일. 모든 row 인터페이스 updated_at 포함.
// =====================================================================

export type SurveyStatus = "draft" | "open" | "closed";
export type SurveyAccessMode = "authenticated" | "public";
export type QuestionType =
  | "single_choice"
  | "multi_choice"
  | "scale"
  | "nps"
  | "number"
  | "text"
  | "textarea"
  | "pre_post_scale";

export interface QuestionOption {
  value: string;
  label: string;
}

export interface QuestionConfig {
  options?: QuestionOption[];
  allow_other?: boolean;
  min?: number;
  max?: number;
  step?: number;
  min_label?: string;
  mid_label?: string;
  max_label?: string;
  before_label?: string;
  after_label?: string;
  unit?: string;
  placeholder?: string;
  max_length?: number;
  segment?: boolean;
  ordinal?: boolean;
  analysis_metric?: string;
  top_box?: string[];
  target?: number;
  option_midpoints?: Record<string, number>;
}

export interface Survey {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: SurveyStatus;
  access_mode: SurveyAccessMode;
  is_anonymous: boolean;
  opens_at: string | null;
  closes_at: string | null;
  created_by: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SurveyQuestion {
  id: string;
  survey_id: string;
  section: string | null;
  order_index: number;
  type: QuestionType;
  title: string;
  description: string | null;
  required: boolean;
  config: QuestionConfig;
  created_at: string;
  updated_at: string;
}

export interface SurveyResponse {
  id: string;
  survey_id: string;
  respondent_user_id: string | null;
  respondent_hash: string | null;
  is_complete: boolean;
  submitted_at: string | null;
  meta: ResponseMeta;
  created_at: string;
  updated_at: string;
}

export interface SurveyAnswer {
  id: string;
  response_id: string;
  question_id: string;
  value_text: string | null;
  value_number: number | null;
  value_json: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface ResponseMeta {
  duration_sec?: number;
  ua?: string;
  [k: string]: unknown;
}

export interface SurveyWithQuestions extends Survey {
  questions: SurveyQuestion[];
}

export interface PrePostValue {
  before: number | null;
  after: number | null;
}
export type AnswerValue =
  | { type: "single_choice"; value: string | null }
  | { type: "multi_choice"; value: string[] }
  | { type: "scale"; value: number | null }
  | { type: "nps"; value: number | null }
  | { type: "number"; value: number | null }
  | { type: "text"; value: string }
  | { type: "textarea"; value: string }
  | { type: "pre_post_scale"; value: PrePostValue };

export interface AnswerColumns {
  question_id: string;
  value_text: string | null;
  value_number: number | null;
  value_json: unknown | null;
}
export interface SubmitResponsePayload {
  answers: AnswerColumns[];
  meta?: ResponseMeta;
  respondent_hash?: string | null;
}

export interface OptionCount {
  value: string;
  label: string;
  n: number;
  pct: number;
}
export interface ScaleStats {
  n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  distribution: { value: number; n: number }[];
  top_box_pct?: number | null;
}
export interface NpsStats {
  n: number;
  score: number | null;
  promoters_pct: number;
  passives_pct: number;
  detractors_pct: number;
}
export interface PrePostStats {
  n_pairwise: number;
  before_mean: number | null;
  after_mean: number | null;
  delta_mean: number | null;
  improvement_pct: number | null;
  before_distribution: { value: number; n: number }[];
  after_distribution: { value: number; n: number }[];
}
export interface NumberStats {
  n: number;
  mean: number | null;
  median: number | null;
  sum: number | null;
  min: number | null;
  max: number | null;
  mean_trimmed: number | null;
  zero_pct: number | null;
  unit: string | null;
}

export type QuestionAggregate = {
  question_id: string;
  section: string | null;
  order_index: number;
  type: QuestionType;
  title: string;
  n: number;
  masked: boolean;
} & (
  | { type: "single_choice"; options: OptionCount[] }
  | { type: "multi_choice"; options: OptionCount[]; respondent_n: number }
  | { type: "scale"; stats: ScaleStats }
  | { type: "nps"; stats: NpsStats }
  | { type: "number"; stats: NumberStats }
  | { type: "pre_post_scale"; stats: PrePostStats }
  | { type: "text" | "textarea"; text_n: number }
);

export interface SegmentFilter {
  question_id: string;
  values: string[];
}
export interface SurveyResultSummary {
  survey_id: string;
  total_responses: number;
  complete_rate: number;
  avg_duration_sec: number | null;
  segments_applied: SegmentFilter[];
  questions: QuestionAggregate[];
}
