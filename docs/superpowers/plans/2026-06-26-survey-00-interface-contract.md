The spec and all reference files are read. Conventions confirmed: `createServerSupabase()` + `auth.getUser()` + `user_profiles.role` admin gate (401/403), `{ params }: { params: Promise<{ id: string }> }` with `await params`, snake_case DB columns, `string` ISO timestamps in row types, `"use client"` pages, shadcn ui (no chart/dnd libs present). Here is the frozen contract.

---

# 설문 시스템 인터페이스 계약 (FROZEN — v1)

> 단일 출처: `docs/superpowers/specs/2026-06-26-survey-system-design.md`. 3개 Phase의 모든 태스크는 아래 시그니처를 **글자 그대로** 참조한다. 변경 시 본 계약을 먼저 개정한다. 모든 경로는 `frontend/` 기준 절대경로.

## 0. 검증/테스트 규약 (확정)

- 순수 로직(`lib/survey.ts`, `lib/survey-metrics.ts`)은 **Vitest TDD**: 실패 테스트 작성 → 실행해 실패 확인 → 최소 구현 → 통과 → 커밋.
- UI 플로우(응답 폼/빌더/대시보드)는 **Playwright E2E**.
- 타입: `cd frontend && npm run build` (tsc) / 품질: `cd frontend && npm run lint`.
- DB: `mcp__supabase__apply_migration` 적용 후 `mcp__supabase__get_advisors(security)`. 적용 전 트랜잭션 내 실행→롤백 사전검증.
- Vitest/Playwright는 **Phase 1 첫 태스크**에서 `frontend/`에 신규 도입(아래 §7 파일맵의 설정 파일). 모든 npm 명령은 `frontend/` 기준.

신규 devDependency (Phase1 T1에서 설치):
```
vitest  @vitest/coverage-v8  @vitejs/plugin-react  jsdom  @testing-library/react  @testing-library/jest-dom  @playwright/test
```
package.json scripts 추가:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test"
```

---

## 1. `frontend/src/types/survey.ts` (전체 — 동결)

```typescript
// =====================================================================
// 설문 시스템 타입 계약 (스펙 §4.5 기준). snake_case 통일. 모든 row 인터페이스 updated_at 포함.
// =====================================================================

// ── 열거형 ──
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

// ── 옵션 ──
export interface QuestionOption {
  value: string;
  label: string;
}

// ── 문항 config (snake_case 통일 + 분석 메타) ──
export interface QuestionConfig {
  // 선택형
  options?: QuestionOption[];
  allow_other?: boolean;
  // 척도/숫자
  min?: number;
  max?: number;
  step?: number;
  min_label?: string;
  mid_label?: string;
  max_label?: string;
  // pre_post_scale 라벨 (기본 "도입 전" / "현재")
  before_label?: string;
  after_label?: string;
  // 숫자/텍스트
  unit?: string;
  placeholder?: string;
  max_length?: number;
  // ── 분석 메타 (결정 #9) ──
  segment?: boolean;                          // 세그먼트 필터 후보
  ordinal?: boolean;                          // 순서형 여부(명목형 false → 평균·상관 제외)
  analysis_metric?: string;                   // KPI 레지스트리 키
  top_box?: string[];                         // top-box 비율 계산 옵션 집합
  target?: number;                            // 신호등 벤치마크
  option_midpoints?: Record<string, number>;  // 구간 중앙값(S2Q2 throughput)
}

// ── DB Row 인터페이스 (timestamptz → ISO string) ──
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

// ── 조합 DTO ──
export interface SurveyWithQuestions extends Survey {
  questions: SurveyQuestion[];
}

// ── 답변 값 판별 유니온 (클라이언트 폼 상태) ──
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

// ── 제출 페이로드 (RPC submit_survey_response에 매핑) ──
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

// ── 집계 DTO (get_survey_aggregate RPC 반환) ──
export interface OptionCount {
  value: string;
  label: string;
  n: number;
  pct: number;       // 0~100
}
export interface ScaleStats {
  n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  distribution: { value: number; n: number }[];
  top_box_pct?: number | null;   // top-2-box 등
}
export interface NpsStats {
  n: number;
  score: number | null;          // −100~100
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
  mean_trimmed: number | null;   // 이상치 트리밍 후
  zero_pct: number | null;
  unit: string | null;
}

export type QuestionAggregate = {
  question_id: string;
  section: string | null;
  order_index: number;
  type: QuestionType;
  title: string;
  n: number;                     // 해당 문항 응답 수
  masked: boolean;               // n<5 셀 마스킹 여부
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
  values: string[];              // 같은 세그먼트 내 OR
}
export interface SurveyResultSummary {
  survey_id: string;
  total_responses: number;       // is_complete=true 모수
  complete_rate: number;         // 0~100
  avg_duration_sec: number | null;
  segments_applied: SegmentFilter[];
  questions: QuestionAggregate[];
}
```

---

## 2. `frontend/src/lib/survey.ts` (공개 시그니처 — 동결)

```typescript
import type {
  QuestionType, SurveyQuestion, QuestionConfig,
  AnswerValue, AnswerColumns,
} from "@/types/survey";

// 문항 타입 메타: 빌더 타입 선택기 + 렌더러 분기 + 기본값의 단일 출처
export interface QuestionTypeMeta {
  type: QuestionType;
  label: string;          // 한국어 표시명 (예: "객관식 단일")
  description: string;
  icon: string;           // lucide 아이콘 이름 (문자열 키, 빌더에서 매핑)
  value_column: "value_text" | "value_number" | "value_json";
  supports_options: boolean;
  supports_other: boolean;
  is_numeric: boolean;
}
export const QUESTION_TYPE_META: Record<QuestionType, QuestionTypeMeta>;

// 타입별 config 기본값 (빌더 신규 문항 생성 시)
export function default_config_for(type: QuestionType): QuestionConfig;

// 검증 결과
export interface ValidationResult {
  ok: boolean;
  error?: string;         // 한국어 에러 메시지 (ok=false일 때)
}

// 단일 문항 + 입력값 검증 (required, exclusive 보기, 범위, nps 0~10, max_length, '없음' 단독 등)
export function validateAnswer(
  question: SurveyQuestion,
  value: AnswerValue,
): ValidationResult;

// 폼 AnswerValue → DB 컬럼 매핑 (저장 컨벤션 §3.1). 미응답(빈 값)은 null 컬럼 반환.
export function answerToColumns(
  question: SurveyQuestion,
  value: AnswerValue,
): AnswerColumns;

// (보조, 폼 초기화용) DB 컬럼 → AnswerValue 역매핑
export function columnsToAnswer(
  question: SurveyQuestion,
  columns: Pick<AnswerColumns, "value_text" | "value_number" | "value_json">,
): AnswerValue;

// (보조) 문항의 빈 AnswerValue 초기값
export function emptyAnswer(question: SurveyQuestion): AnswerValue;
```

저장 컨벤션(§3.1) 매핑 표 — `answerToColumns` 구현 계약:

| type | value_text | value_number | value_json |
|---|---|---|---|
| single_choice | 선택 `value` | null | null |
| multi_choice | null | null | `["a","c"]` |
| scale | null | 정수 | null |
| nps | null | 0~10 | null |
| number | null | 실수 | null |
| text / textarea | 원문 | null | null |
| pre_post_scale | null | null | `{"before":n,"after":n}` |

---

## 3. `frontend/src/lib/survey-metrics.ts` (KPI 레지스트리 — 동결)

```typescript
import type {
  QuestionAggregate, SurveyResultSummary, NpsStats,
} from "@/types/survey";

// ── 순수 산식 (Vitest TDD 대상) ──

// NPS = 추천(≥9)% − 비추천(≤6)%. scores: 0~10 배열.
export function npsFromScores(scores: number[]): NpsStats;

// pre_post Δ: pairwise(before·after 동시 존재)만. null·평균대체 금지.
export interface PrePostDelta {
  n_pairwise: number;
  before_mean: number | null;
  after_mean: number | null;
  delta_mean: number | null;       // after_mean − before_mean
  improvement_pct: number | null;  // (after−before)/before×100
}
export function prePostDelta(
  pairs: { before: number; after: number }[],
): PrePostDelta;

// top-box 비율: 전체 응답 중 top_box value 집합에 속한 비율(0~100). '모름' 등 분모 제외 옵션.
export function topBoxRatio(
  counts: { value: string; n: number }[],
  topBox: string[],
  excludeValues?: string[],
): { pct: number | null; n_valid: number };

// 가중 평균(option_midpoints로 구간 → 수치): S2Q2 throughput multiplier
export function weightedMean(
  counts: { value: string; n: number }[],
  midpoints: Record<string, number>,
): { mean: number | null; n: number };

// 절감시간 ROI: avg_hours_saved × users × hourly_cost(원/시간) − license_cost
export interface RoiInput {
  avg_weekly_hours_saved: number;
  user_count: number;
  hourly_cost: number;        // app_settings 인건비
  annual_license_cost: number;
  weeks_per_year?: number;    // 기본 48
}
export interface RoiResult {
  annual_hours_saved: number;
  annual_value: number;
  net_annual: number;         // annual_value − license_cost
  payback_months: number | null;
}
export function computeRoi(input: RoiInput): RoiResult;

// 신호등 상태: target 대비
export type TrafficLight = "green" | "amber" | "red" | "unset";
export function trafficLight(value: number | null, target?: number): TrafficLight;

// ── KPI 레지스트리 (스펙 §5.3 5종) ──
export type KpiId =
  | "pre_post_overall"      // ① 도입 전후 개선 Δ      (S1Q1)
  | "weekly_hours_saved"    // ② 가중 연간 절감시간/ROI (S2Q1)
  | "value_ratio"           // ③ 비용 이상 비율         (S2Q3)
  | "nps"                   // ④ 사용자 NPS            (S4Q1)
  | "license_support";      // ⑤ 유지 지지도+중단영향    (S4Q2 + S4Q3)

export interface KpiDefinition {
  id: KpiId;                          // = config.analysis_metric 매칭 키
  label: string;                      // 카드 제목 (한국어)
  unit: "delta" | "hours" | "percent" | "score" | "ratio";
  population: "all" | "users" | "heavy_users";
  // 해당 KPI에 결선된 QuestionAggregate(들)로 카드 값 계산
  compute: (
    summary: SurveyResultSummary,
    ctx: KpiContext,
  ) => KpiCardData;
}
export interface KpiContext {
  hourly_cost?: number;
  user_count?: number;
  annual_license_cost?: number;
}
export interface KpiCardData {
  id: KpiId;
  label: string;
  value: number | null;
  display: string;            // 포맷된 표시 문자열 (예: "+1.8 (42%↑)")
  secondary?: string;         // 보조 지표 (이중 분모·신뢰구간 등)
  population_label: string;   // 모수 라벨 강제 (전체/사용자/헤비유저)
  traffic: TrafficLight;
  note?: string;              // 한계 고지 (자기보고 상향편향 등)
  unset: boolean;             // analysis_metric 미태깅 → "미설정"
}

export const KPI_REGISTRY: Record<KpiId, KpiDefinition>;

// analysis_metric 태그로 문항↔KPI 결선 후 카드 산출
export function buildKpiCards(
  summary: SurveyResultSummary,
  ctx?: KpiContext,
): KpiCardData[];

// is_user 단일 정의: S0Q3='사용한 적 없음' OR S0Q4='거의 사용 안 함' → 비사용자
export function isUserResponse(args: {
  s0q3_value: string | null;
  s0q4_value: string | null;
}): boolean;
```

---

## 4. RPC 시그니처 (동결 — 마이그레이션 §3.3)

```sql
-- 제출 (유일 쓰기 경로)
public.submit_survey_response(
  p_survey_id       uuid,
  p_answers         jsonb,                         -- [{question_id, value_text, value_number, value_json}, ...]
  p_meta            jsonb default '{}'::jsonb,
  p_respondent_hash text  default null
) returns uuid                                     -- response_id
-- security definer, grant execute to authenticated, anon
-- 예외: survey_not_open | auth_required | already_submitted

-- 집계 (admin 게이트, n<5 마스킹)
public.get_survey_aggregate(
  p_survey_id uuid,
  p_segments  jsonb default '[]'::jsonb            -- [{question_id, values:[...]}, ...]
) returns jsonb                                    -- SurveyResultSummary shape
-- security definer, grant execute to authenticated. private.is_admin() 아니면 'forbidden'
```

클라이언트 호출부 (서버 라우트 내, `createServerSupabase()` 클라이언트):

```typescript
// 제출
const { data: responseId, error } = await supabase.rpc("submit_survey_response", {
  p_survey_id: surveyId,
  p_answers: payload.answers,                 // AnswerColumns[]
  p_meta: payload.meta ?? {},
  p_respondent_hash: payload.respondent_hash ?? null,
});
// error.message ∈ { survey_not_open, auth_required, already_submitted } → API에서 409/410/401 매핑

// 집계
const { data: summary, error } = await supabase.rpc("get_survey_aggregate", {
  p_survey_id: surveyId,
  p_segments: segments,                       // SegmentFilter[]
});
// summary: SurveyResultSummary (jsonb)
```

RPC 에러 → HTTP 매핑 계약: `survey_not_open` → 409(마감)/410(없음 판단 시), `auth_required` → 401, `already_submitted` → 409, `forbidden` → 403.

---

## 5. API 라우트 요청/응답 shape (8개 — 동결)

모든 admin 라우트는 `chat-history/route.ts`와 동일 게이트: `auth.getUser()` 없음 → 401 `{error}`, `user_profiles.role !== "admin"` → 403 `{error}`. 동적 라우트는 `{ params }: { params: Promise<{...}> }` + `await params`. 에러 응답 공통 shape: `{ error: string }`.

### 5.1 `GET /api/surveys/[slug]` — 공개*(access_mode 재확인)
- Req: path `slug`. 쿼리 없음.
- 200: `SurveyWithQuestions`
- 404: status≠open 이거나 미존재 / 410: closed(만료) / 401: `access_mode=authenticated` & 비로그인

### 5.2 `POST /api/surveys/[slug]/responses` — access_mode 의존
- Req body: `SubmitResponsePayload` (`{ answers: AnswerColumns[]; meta?; respondent_hash? }`)
- 200: `{ response_id: string }`
- 400: 서버 검증 실패 `{ error }` / 401: auth_required / 409: already_submitted 또는 survey_not_open(마감) / 410: 미존재

### 5.3 `GET /api/admin/surveys` — admin
- Req query: `?status=draft|open|closed` (옵션)
- 200: `{ items: SurveyListItem[] }`, `SurveyListItem = Survey & { response_count: number; complete_count: number }`

### 5.4 `POST /api/admin/surveys` — admin
- Req body: `{ slug: string; title: string; description?: string; access_mode?: SurveyAccessMode; is_anonymous?: boolean }`
- 200: `Survey` (status 기본 `draft`, `created_by=user.id`)
- 409: slug 중복 `{ error }`

### 5.5 `/api/admin/surveys/[id]` — admin (GET·PATCH·DELETE)
- GET 200: `SurveyWithQuestions`
- PATCH Req body(부분): `{ title?; description?; status?: SurveyStatus; access_mode?; is_anonymous?; opens_at?; closes_at?; slug?; sort_order? }` → 200: `Survey`. status 전이/slug 중복 위반 409.
- DELETE 200: `{ ok: true }` (cascade)

### 5.6 `/api/admin/surveys/[id]/questions` — admin (GET·POST·PUT)
- GET 200: `{ items: SurveyQuestion[] }` (order_index 정렬)
- POST Req body: `{ type: QuestionType; title: string; section?: string; description?: string; required?: boolean; config?: QuestionConfig; order_index?: number }` → 200: `SurveyQuestion`
- PUT(일괄 reorder·section) Req body: `{ items: { id: string; order_index: number; section?: string | null }[] }` → 200: `{ items: SurveyQuestion[] }`

### 5.7 `/api/admin/surveys/[id]/questions/[questionId]` — admin (PATCH·DELETE)
- PATCH Req body(부분): `{ title?; type?: QuestionType; section?; description?; required?; config?: QuestionConfig; order_index? }` → 200: `SurveyQuestion`
- DELETE 200: `{ ok: true }`

### 5.8 `GET /api/admin/surveys/[id]/analytics` — admin
- Req query: `?segments=<URL인코딩 JSON>` (`SegmentFilter[]`, 옵션), `?includeIncomplete=true` (옵션)
- 200: `SurveyResultSummary`

### 5.9 `GET /api/admin/surveys/[id]/export` — admin (Node 런타임)
- Req query: `?format=csv|xlsx` (기본 csv), `?scope=raw|aggregate|all` (기본 all), `?includeIdentity=true` (감사, 기본 false)
- 200: 파일 스트림. Headers: `Content-Type: text/csv; charset=utf-8` (또는 xlsx/zip MIME), `Content-Disposition: attachment; filename*=UTF-8''<URL인코딩>.csv`. 본문 UTF-8 BOM(`\uFEFF`) + CRLF.

> 라우트 파일에 `export const runtime = "nodejs";` 명시(export). 나머지 라우트는 기본.

---

## 6. 핵심 컴포넌트 props (동결)

```typescript
// ── 응답 폼 (components/survey/) ──

// SurveyForm — 섹션 그룹핑·진행률·서버검증·완료/중복/마감 분기 컨테이너
export interface SurveyFormProps {
  survey: SurveyWithQuestions;
  isAuthenticated: boolean;
  onSubmitted?: (responseId: string) => void;
}

// QuestionRenderer — type 분기 디스패처
export interface QuestionRendererProps {
  question: SurveyQuestion;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  error?: string;
  disabled?: boolean;
}

// renderers/* 8종 공통 props (각 타입별 value 좁힘)
export interface FieldRendererProps<V extends AnswerValue = AnswerValue> {
  question: SurveyQuestion;
  value: V;
  onChange: (value: V) => void;
  error?: string;
  disabled?: boolean;
}
// SingleChoiceField   : FieldRendererProps<{type:"single_choice"; value:string|null}>
// MultiChoiceField    : FieldRendererProps<{type:"multi_choice"; value:string[]}>
// ScaleField          : FieldRendererProps<{type:"scale"; value:number|null}>
// NpsField            : FieldRendererProps<{type:"nps"; value:number|null}>
// NumberField         : FieldRendererProps<{type:"number"; value:number|null}>
// TextField           : FieldRendererProps<{type:"text"; value:string}>
// TextareaField       : FieldRendererProps<{type:"textarea"; value:string}>
// PrePostScaleField   : FieldRendererProps<{type:"pre_post_scale"; value:PrePostValue}>  (2열 레이아웃)

// ── 차트 프리미티브 (components/admin/surveys/charts/) — 0-dependency CSS/SVG ──
export interface HBarItem { label: string; value: number; pct: number; }
export interface HBarProps {
  items: HBarItem[];
  showPct?: boolean;
  note?: string;           // "복수응답 합계 100%↑" 등
}
export interface GaugeProps {
  value: number;           // 표시값
  min: number; max: number;
  label?: string;
  target?: number;         // 신호등 마커
  variant?: "scale" | "nps";  // nps: −100~100
}
export interface HistogramProps {
  bins: { label: string; n: number }[];
  meanLine?: number;
  unit?: string;
}
export interface PrePostBarsProps {
  beforeMean: number;
  afterMean: number;
  delta: number;
  improvementPct: number | null;
  nPairwise: number;
  scaleMax: number;
}

// QuestionAggregateCard — 타입→시각화 디스패치 (대시보드 문항 카드)
export interface QuestionAggregateCardProps {
  aggregate: QuestionAggregate;
  populationLabel: string;
}

// KpiCard — 경영 요약
export interface KpiCardProps {
  card: KpiCardData;
}

// ── 빌더 (components/admin/surveys/) ──

// QuestionTypePicker — QUESTION_TYPE_META 기반 타입 선택기
export interface QuestionTypePickerProps {
  value?: QuestionType;
  onSelect: (type: QuestionType) => void;
}

// QuestionEditor — 인라인 편집 (title·type·config·required·section)
export interface QuestionEditorProps {
  question: SurveyQuestion;
  onChange: (patch: Partial<SurveyQuestion>) => void;
  onDelete: () => void;
}

// QuestionConfigEditor — type별 config 폼 (options/labels/분석메타)
export interface QuestionConfigEditorProps {
  type: QuestionType;
  config: QuestionConfig;
  onChange: (config: QuestionConfig) => void;
}

// SurveyBuilder — 순서변경(네이티브 HTML5 drag, 신규 라이브러리 0)·섹션·일괄 reorder
export interface SurveyBuilderProps {
  surveyId: string;
  questions: SurveyQuestion[];
  onReorder: (items: { id: string; order_index: number; section?: string | null }[]) => void;
  onQuestionChange: (id: string, patch: Partial<SurveyQuestion>) => void;
  onAddQuestion: (type: QuestionType, section?: string) => void;
  onDeleteQuestion: (id: string) => void;
}

// SegmentFilterBar — 대시보드 상단 세그먼트 멀티셀렉트
export interface SegmentFilterBarProps {
  segmentQuestions: SurveyQuestion[];   // config.segment=true
  value: SegmentFilter[];
  onChange: (filters: SegmentFilter[]) => void;
}
```

> import 컨벤션: 모든 props 타입은 `@/types/survey`·`@/lib/survey-metrics`에서 import. lucide 아이콘은 `lucide-react`. drag&drop은 신규 라이브러리 없이 HTML5 native(`draggable`/`onDragStart`/`onDrop`).

---

## 7. 파일 구조 맵 (절대경로 + 한 줄 책임)

### 생성 — 설정/테스트 인프라 (Phase1 T1)
| 경로 | 책임 |
|---|---|
| `/Users/seunguk.kang/Repos/inje-playground/frontend/vitest.config.ts` | Vitest 설정(jsdom, @/ alias, coverage v8) |
| `/Users/seunguk.kang/Repos/inje-playground/frontend/playwright.config.ts` | Playwright E2E 설정(baseURL 3003, webServer) |
| `/Users/seunguk.kang/Repos/inje-playground/frontend/vitest.setup.ts` | jest-dom 매처 등록 |
| `/Users/seunguk.kang/Repos/inje-playground/frontend/package.json` | (수정) test/test:watch/test:e2e scripts + devDeps |
| `/Users/seunguk.kang/Repos/inje-playground/frontend/tsconfig.json` | (수정) vitest/playwright 타입 반영 |

### 생성 — 타입·로직 (Phase1, Vitest TDD)
| 경로 | 책임 |
|---|---|
| `.../frontend/src/types/survey.ts` | §1 전체 타입 계약 |
| `.../frontend/src/lib/survey.ts` | QUESTION_TYPE_META, default_config_for, validateAnswer, answerToColumns, columnsToAnswer, emptyAnswer |
| `.../frontend/src/lib/survey-metrics.ts` | KPI 레지스트리·순수 산식(npsFromScores·prePostDelta·topBoxRatio·weightedMean·computeRoi·trafficLight·buildKpiCards·isUserResponse) |
| `.../frontend/src/lib/survey-csv.ts` | CSV 직렬화(UTF-8 BOM+CRLF, 더미컬럼, pre_post 3컬럼, 이스케이프) — export 라우트용 |
| `.../frontend/src/lib/__tests__/survey.test.ts` | validateAnswer·answerToColumns 단위테스트 |
| `.../frontend/src/lib/__tests__/survey-metrics.test.ts` | NPS·prePostDelta·topBox·ROI 단위테스트 |
| `.../frontend/src/lib/__tests__/survey-csv.test.ts` | CSV 직렬화 단위테스트 |

### 생성 — DB
| 경로 | 책임 |
|---|---|
| 마이그레이션 `survey_system_init` (apply_migration) | §3.2 4테이블+RLS+트리거+보조함수 / §3.3 두 RPC 합본 |
| `.../frontend/src/lib/survey-seed.sql` 또는 마이그레이션 `claude_code_productivity_survey` | 첫 설문 25문항 시드(§6) |

### 생성 — API 라우트 (Phase1: 응답계열 / Phase2·3: admin)
| 경로 | 책임 |
|---|---|
| `.../frontend/src/app/api/surveys/[slug]/route.ts` | GET 설문+문항(access_mode 재확인) |
| `.../frontend/src/app/api/surveys/[slug]/responses/route.ts` | POST submit_survey_response RPC |
| `.../frontend/src/app/api/admin/surveys/route.ts` | GET 목록(response_count)/POST 생성 |
| `.../frontend/src/app/api/admin/surveys/[id]/route.ts` | GET·PATCH·DELETE 설문 |
| `.../frontend/src/app/api/admin/surveys/[id]/questions/route.ts` | GET·POST·PUT(reorder) 문항 |
| `.../frontend/src/app/api/admin/surveys/[id]/questions/[questionId]/route.ts` | PATCH·DELETE 개별 문항 |
| `.../frontend/src/app/api/admin/surveys/[id]/analytics/route.ts` | GET get_survey_aggregate RPC |
| `.../frontend/src/app/api/admin/surveys/[id]/export/route.ts` | GET CSV/xlsx (runtime="nodejs") |

### 생성 — 페이지 (App Router)
| 경로 | 책임 |
|---|---|
| `.../frontend/src/app/survey/page.tsx` | 공개+진행중 설문 목록 |
| `.../frontend/src/app/survey/[slug]/page.tsx` | 응답 폼(SurveyForm 호스트, 완료/중복/마감 분기) |
| `.../frontend/src/app/admin/surveys/page.tsx` | 관리 목록(상태배지·응답수) |
| `.../frontend/src/app/admin/surveys/new/page.tsx` | 메타 생성 |
| `.../frontend/src/app/admin/surveys/[id]/edit/page.tsx` | 범용 빌더 |
| `.../frontend/src/app/admin/surveys/[id]/analytics/page.tsx` | 집계 대시보드(+summary 경영요약 탭) |

### 생성 — 컴포넌트
| 경로 | 책임 |
|---|---|
| `.../frontend/src/components/survey/SurveyForm.tsx` | 폼 컨테이너(진행률·검증·제출) |
| `.../frontend/src/components/survey/QuestionRenderer.tsx` | type 분기 디스패처 |
| `.../frontend/src/components/survey/renderers/SingleChoiceField.tsx` | 단일선택 |
| `.../frontend/src/components/survey/renderers/MultiChoiceField.tsx` | 복수선택(exclusive '없음' 단독) |
| `.../frontend/src/components/survey/renderers/ScaleField.tsx` | Likert |
| `.../frontend/src/components/survey/renderers/NpsField.tsx` | 0~10 |
| `.../frontend/src/components/survey/renderers/NumberField.tsx` | 숫자(단위) |
| `.../frontend/src/components/survey/renderers/TextField.tsx` | 단문 |
| `.../frontend/src/components/survey/renderers/TextareaField.tsx` | 장문 |
| `.../frontend/src/components/survey/renderers/PrePostScaleField.tsx` | 도입전/현재 2열 |
| `.../frontend/src/components/admin/surveys/SurveyBuilder.tsx` | 빌더(드래그·섹션) |
| `.../frontend/src/components/admin/surveys/QuestionTypePicker.tsx` | 타입 선택기 |
| `.../frontend/src/components/admin/surveys/QuestionEditor.tsx` | 인라인 편집 |
| `.../frontend/src/components/admin/surveys/QuestionConfigEditor.tsx` | type별 config 폼 |
| `.../frontend/src/components/admin/surveys/SegmentFilterBar.tsx` | 세그먼트 멀티셀렉트 |
| `.../frontend/src/components/admin/surveys/QuestionAggregateCard.tsx` | 문항 시각화 카드 |
| `.../frontend/src/components/admin/surveys/KpiCard.tsx` | 경영 KPI 카드 |
| `.../frontend/src/components/admin/surveys/charts/HBar.tsx` | 수평 막대 |
| `.../frontend/src/components/admin/surveys/charts/Gauge.tsx` | 게이지(scale/nps) |
| `.../frontend/src/components/admin/surveys/charts/Histogram.tsx` | 히스토그램 |
| `.../frontend/src/components/admin/surveys/charts/PrePostBars.tsx` | 전후 그룹막대+Δ |

### 생성 — E2E
| 경로 | 책임 |
|---|---|
| `.../frontend/e2e/survey-respond.spec.ts` | 응답 폼 제출/중복/마감 플로우 |
| `.../frontend/e2e/survey-builder.spec.ts` | 빌더 생성·문항편집·reorder |
| `.../frontend/e2e/survey-analytics.spec.ts` | 대시보드·세그먼트·내보내기 |

### 수정 — 진입점 4파일 (§4.2)
| 경로 | 변경 |
|---|---|
| `.../frontend/src/lib/roles.ts` | `ROLE_ACCESS` 전 역할에 `/survey` 추가(guest·user·admin). `/admin/surveys`는 `/admin` prefix로 커버 |
| `.../frontend/src/app/page.tsx` | `FEATURES`에 설문 카드(`href:"/survey"`, `ClipboardList`) 추가 |
| `.../frontend/src/app/admin/layout.tsx` | `ADMIN_NAV`에 `{ href:"/admin/surveys", label:"설문 관리", icon: ClipboardList }` 추가 |
| `.../frontend/src/lib/supabase-middleware.ts` | 비로그인 리다이렉트 예외에 `!pathname.startsWith("/survey")` 추가. `PROTECTED_ROUTES`에는 미추가(access_mode는 페이지+API가 제어) |

---

### 동결 불변식 (모든 태스크 준수)
1. config 키는 **snake_case만** — `min_label`/`allow_other`/`analysis_metric`/`top_box`/`segment`/`target`/`option_midpoints`.
2. 쓰기는 **`submit_survey_response` RPC 단일 경로**, 집계는 **`get_survey_aggregate` RPC 단일 경로**. 클라 TS 집계 금지(CSV 후처리만 허용).
3. row 타입은 전부 `updated_at` 포함, timestamptz는 ISO `string`, nullable은 `| null`.
4. 분석 출력에 `respondent_user_id`/`respondent_hash` **절대 미포함**(관리자 익명성). CSV는 `includeIdentity=true`만 예외.
5. n<5 세그먼트 셀 **마스킹**(`masked:true`). pre_post Δ는 **pairwise만**, 결측 0/평균대체 금지.
6. admin 게이트는 `chat-history/route.ts` 패턴 그대로(401/403). 동적 라우트 `await params` 필수.
7. 신규 차트/dnd/엑셀 라이브러리 **0개로 시작**(CSS/SVG + HTML5 native drag + BOM CSV). xlsx 단일 멀티시트 요구 시에만 `exceljs`.
8. `is_user` 단일 정의 = `isUserResponse()`(S0Q3='사용한 적 없음' OR S0Q4='거의 사용 안 함' → 비사용자) — 중복 정의 금지.