/**
 * 할 일 AI — JARVIS `analyze-todo`(자연어 파싱 + 분류 한 번)·`review-todo-weekly`(주간 회고) 프롬프트와 정규화를 옮겼다.
 * AI는 제안만 한다: 분석 결과는 입력 시트에 채워질 뿐 저장은 사용자가 누른다. 입력 문장·결과는 저장·로그하지 않는다.
 */
import Anthropic from "@anthropic-ai/sdk";

export const TODO_TEXT_MAX = 400;
const PRIORITIES = ["p1", "p2", "p3", "p4"] as const;
export type TodoPriority = (typeof PRIORITIES)[number];
export type TodoAnalysis = { title: string; scheduled_for: string | null; estimated_minutes: number | null; priority: TodoPriority; context_tags: string[] };

export const todoModel = () => process.env.TODO_LLM_MODEL || "claude-sonnet-5-5";
export const todoAiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

export const ANALYZE_PROMPT = `너는 사용자의 자연어 문장을 **구조화된 TODO JSON 1개**로 한 번에 분석한다.
두 가지 작업을 동시에 수행: (A) 자연어 파싱 (title 정리 + scheduled_for 추출), (B) 분류 (priority / estimated_minutes / context_tags).

입력: 한국어/영어 한 줄 또는 두 줄.
출력: **오직** JSON 객체 1개. 추가 텍스트·설명·코드펜스 금지.

스키마:
{
  "title": string,                        // 시간/날짜 표현 제거 후 동사+목적어 중심 (40자 이내)
  "scheduled_for": string | null,         // ISO 8601 KST (+09:00). 시간 단서 없으면 null
  "estimated_minutes": number | null,     // 명시적 단서 또는 경험치 (null 가능)
  "priority": "p1" | "p2" | "p3" | "p4",  // 반드시 4개 중 하나 (정보 없으면 p3)
  "context_tags": string[]                // 0~4개, "@"로 시작하는 소문자 한영 단일 단어
}

─── 규칙: title ─────────────────────────
- 시간/날짜 문구 제거: "내일 오후 3시에 김부장님께 보고서 보내기" → "김부장님께 보고서 보내기"
- 자연스러운 동사 포함. "~하기" 어미 유지. 40자 이내.

─── 규칙: scheduled_for ─────────────────
- "내일 오후 3시" / "tomorrow 3pm" → 다음 날 15:00
- "모레 아침" / "morning" → 09:00
- "다음 주 월요일" / "next Monday" → 그 월요일 09:00
- "오늘 저녁" / "tonight" → 오늘 19:00
- 시간대는 전부 KST (+09:00). 날짜 단서 전혀 없으면 null. 지난 날짜로 계산되면 다음 해당일로 보정.

─── 규칙: priority ──────────────────────
- p1: 긴급+중요 (오늘까지, 마감 임박, "꼭", 고객·장애·보고 마감, 큰 금액)
- p2: 중요하지만 긴급X (기획/준비/학습 — 성장·중장기)
- p3: 기본 — 정보 부족 시 여기 (일반 업무, 연락, 정리)
- p4: 선택/여유 ("언젠가", "보면 좋음")
- null 반환 금지 — 항상 4개 중 하나 선택.

─── 규칙: estimated_minutes ─────────────
- 명시적 단서(30분/한 시간/두 시간) → 30, 60, 120
- 경험치로 합리적 추정 가능하면 기입 (15/30/60/120/240 등 라운드). 확신 없으면 null. 최대 60*24*7.

─── 규칙: context_tags ──────────────────
- "어디서/어떤 도구로" 우선. 예: @office, @home, @computer, @phone, @errand, @waiting, @meeting
- 카테고리보다 실행 컨텍스트 우선. 명확하지 않으면 [].

─── 예시 ──────────────────────────────
입력: "내일 오후 3시에 김부장님께 보고서 보내기"
출력: {"title":"김부장님께 보고서 보내기","scheduled_for":"2026-04-25T15:00:00+09:00","estimated_minutes":30,"priority":"p1","context_tags":["@computer","@office"]}`;

export const REVIEW_PROMPT = `너는 사용자의 지난 7일 TODO 통계를 받아 **친근하고 실용적인 주간 회고**를 작성한다.

입력(JSON): {
  "done": number,                 // 완료 개수
  "open": number,                 // 남은 개수
  "migrated": number,             // 2회 이상 이월된 개수
  "by_priority": {p1,p2,p3,p4},   // 우선순위별 완료 수
  "top_tags": string[],           // 자주 등장한 context_tags
  "carryover_titles": string[]    // 여러 번 미뤄진 TODO 제목 (최대 5개)
}

출력: 한국어 markdown 단문. 문장 수 4~6개 이내로 짧게. 이모지 1~2개 허용.

구조 (반드시 이 순서):
1) 이번 주 요약 한 문장 — 숫자 강조("이번 주 X건 완료, Y건 이월").
2) 잘한 점 한 문장 — by_priority 에서 p1/p2 완료가 높으면 칭찬. 낮으면 생략.
3) 눈에 띄는 패턴 한 문장 — migrated 가 많거나 특정 tag 이 반복되면 언급.
4) 다음 주 제안 3가지 — 불릿 리스트. 구체적 실행 문장("월요일 오전에 ~ 30분 블록 확보", "~ TODO 를 잘게 쪼개기").

톤: 따뜻한 동료처럼. 평가·훈계 금지. 성과 없으면 다음 주 회복 초점.
입력이 { "done":0, "open":0 } 등 데이터가 비면 "지난 주엔 기록이 적었네요. 이번 주엔 작은 할 일 2~3개부터 시작해 봐요." 처럼 응원.`;

/** KST 오늘 YYYY-MM-DD. */
export function kstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 응답 글에서 JSON 객체 부분(코드펜스·앞뒤 말 무시). */
export function extractJson(text: string): unknown {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("JSON 없음");
  return JSON.parse(text.slice(s, e + 1));
}

/** 모델 출력 → 앱이 쓰는 값만(JARVIS normalizeAnalyze와 같은 범위). 모양이 틀리면 null. */
export function normalizeAnalysis(raw: unknown, fallbackText: string): TodoAnalysis | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  let title = String(r.title ?? "").trim();
  if (!title) title = fallbackText.slice(0, 80);
  title = title.slice(0, 120);
  let scheduled: string | null = null;
  if (typeof r.scheduled_for === "string" && r.scheduled_for.trim()) {
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(r.scheduled_for.trim()) ? r.scheduled_for.trim() : `${r.scheduled_for.trim()}+09:00`); // 시간대 없으면 KST로 본다
    if (!Number.isNaN(d.getTime())) scheduled = d.toISOString();
  }
  let minutes: number | null = null;
  if (typeof r.estimated_minutes === "number" && Number.isFinite(r.estimated_minutes)) {
    minutes = Math.max(1, Math.floor(r.estimated_minutes));
    if (minutes > 60 * 24 * 7) minutes = null;
  }
  const p = String(r.priority ?? "").trim().toLowerCase();
  const priority = (PRIORITIES as readonly string[]).includes(p) ? (p as TodoPriority) : "p3";
  const tags = [...new Set((Array.isArray(r.context_tags) ? r.context_tags : [])
    .map((t) => String(t ?? "").trim().toLowerCase().replace(/\s+/g, ""))
    .filter((t) => t && t.length <= 20)
    .map((t) => (t.startsWith("@") ? t : `@${t}`)))].slice(0, 4);
  return { title, scheduled_for: scheduled, estimated_minutes: minutes, priority, context_tags: tags };
}

type Messages = Pick<Anthropic, "messages">;
async function complete(client: Messages, system: string, user: string, maxTokens: number): Promise<string> {
  const msg = await client.messages.create({
    model: todoModel(), max_tokens: maxTokens, system, messages: [{ role: "user", content: user }],
    // Sonnet 5.5는 생각이 기본으로 켜져 짧은 상한을 생각이 먼저 쓴다 — 끄는 값은 between_tools(briefing-llm.ts와 같음)
    thinking: { type: "between_tools" } as unknown as Anthropic.Messages.ThinkingConfigParam,
  });
  if (msg.stop_reason === "max_tokens") throw new Error("응답이 잘림(max_tokens)");
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  if (!text) throw new Error("응답이 비었습니다");
  return text;
}

export async function analyzeTodo(text: string, deps: { client?: Messages; now?: Date } = {}): Promise<TodoAnalysis> {
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const out = await complete(client, ANALYZE_PROMPT, `[오늘 날짜]: ${kstToday(deps.now)} (Asia/Seoul)\n[입력]: ${text}\n\n출력(JSON 오브젝트만):`, 768);
  const r = normalizeAnalysis(extractJson(out), text);
  if (!r) throw new Error("분석 결과 형식이 맞지 않습니다");
  return r;
}

export type ReviewStats = { done: number; open: number; migrated: number; by_priority: Record<TodoPriority, number>; top_tags: string[]; carryover_titles: string[] };
export type ReviewRow = { state: string; priority: string; context_tags: string[] | null; migration_count: number | null; title: string; completed_at: string | null };

/** 지난 7일 통계(JARVIS buildStats와 같은 셈). rows는 7일 안에 만들어졌거나 바뀐 본인 할 일. */
export function buildReviewStats(rows: ReviewRow[], sinceIso: string): ReviewStats {
  const s: ReviewStats = { done: 0, open: 0, migrated: 0, by_priority: { p1: 0, p2: 0, p3: 0, p4: 0 }, top_tags: [], carryover_titles: [] };
  const tags = new Map<string, number>();
  for (const t of rows) {
    if (t.state === "done" && t.completed_at && t.completed_at >= sinceIso) {
      s.done++;
      const p = (PRIORITIES as readonly string[]).includes(t.priority) ? (t.priority as TodoPriority) : "p3";
      s.by_priority[p]++;
    } else if (t.state === "in_progress") s.open++;
    if ((t.migration_count ?? 0) >= 2) {
      s.migrated++;
      if (s.carryover_titles.length < 5 && t.title) s.carryover_titles.push(t.title.slice(0, 60));
    }
    for (const tag of t.context_tags ?? []) if (tag) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  s.top_tags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
  return s;
}

export async function writeReview(stats: ReviewStats, deps: { client?: Messages } = {}): Promise<string> {
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return complete(client, REVIEW_PROMPT, `입력(JSON):\n${JSON.stringify(stats)}\n\n출력(한국어 markdown):`, 1024);
}
