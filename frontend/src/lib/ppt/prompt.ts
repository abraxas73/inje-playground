/**
 * LLM 프롬프트. 시스템 = [규칙 블록, 카탈로그 블록](둘 다 prompt caching), 사용자 = [원고 블록(캐시), 지시 블록].
 * 패키지 CLAUDE.md(41KB)·sample.deck.yaml(74KB) 원문은 넣지 않는다 — 규칙은 압축본, 카탈로그는 골격 예제.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { PptSourceKind } from "@/types/ppt";
import { isKeep, type DeckJson } from "./deck-json";
import type { PptBuildFail, PptCatalog, PptCatalogEntry } from "./service";
import { SOURCE_KIND_LABEL } from "./source";

const CACHE: Anthropic.CacheControlEphemeral = { type: "ephemeral" };

export const RULES_TEXT = `당신은 이노그리드 표준 PPT 템플릿(v1.0 최신본) 규칙에 맞춰 원고를 deck JSON으로 옮기는 편집자다. 출력은 JSON 객체 하나만 — 설명·마크다운 펜스 금지.

# deck JSON 구조
{"meta":{"title":["1행(2행을 꾸미는 수식구)","2행(주어+서술어, ~합니다.)"],"subtitle":"부제목","ver":"01","date":"YYYY. MM. DD","dept":"부서명","author":"작성자"},
 "sections":[{"name":"섹션 이름","subs":["하위 섹션"],"slides":[{"layout":"장표 이름","sub":"하위 섹션","title":["1행","2행합니다."], ...장표별 키}]}]}
- 섹션은 최대 8개(간지·목차 자동 생성). 하위 섹션(subs)은 최대 5개, 있으면 그 섹션의 장표마다 "sub"를 준다(라벨 "01. 섹션명 : 하위섹션명").
- 원고에 목차가 있으면 그대로 쓴다(변경 금지). 없으면 내용을 분석해 섹션을 만든다.
- 원고가 PPT면 장표 수와 순서를 원고 그대로 유지한다(합치기·나누기·순서 변경 금지). 굵게·크게 강조한 부분은 [[강조]]로 살린다.

# 장표 고르기
1) 무엇을 보여주는가: 행·열 값 → table 계열 / 비율·구성 → chart-donut(≤5항목) / 시계열·크기 비교 → chart-bar·chart-notes(≤5) / 안건 짧은 목록 → agenda-5 / 한 문장 메시지 → message / 그림이 주인공 → image-*(원고 그림이 있을 때만) / 수치 KPI → kpi-* / 논리 관계 서술 → 2)
2) 항목 관계: 독립 나열 → card-N / 결론 먼저+근거 → lead-N / 항목마다 설명→결론 → pill-N / 순서·단계 → steps-N·flow-N·timeline / 전·후 → change-2-* / 둘 비교 → compare-* / 중심-주변 → radial-4 / 축×관점 격자 → columns-3x3
3) 단 수는 이름의 일부다: 항목 수와 정확히 같은 N을 고른다(card-4는 항목 4개 고정). 맞는 N이 없으면 항목을 묶거나 장을 나눈다.
- 표는 행·열 데이터에만. 서술을 표로 만들지 않는다. 표가 본문의 1/4를 넘으면 도식 장표로 바꾼다.
- 표 행 수(머리글 제외)는 카탈로그 '표 자리'의 한 줄 행 수 안에서. 한 행의 셀 글 합이 한 줄 글자 수를 넘어 두 줄로 접히면 한도는 두 줄 행 수로 준다. 행이 더 많으면 table-full로 바꾸거나 두 장으로 나눈다. 셀 글만 줄여서는 행 최소 높이 때문에 해결되지 않는다.
- 템플릿으로 표현하기 어려운 원고 도식(아키텍처 구성도 등)은 free-title에 "source":{"slide":원고 장 번호}로 그대로 이식하고, 같은 내용을 템플릿 장표 한 장으로 요약해 뒤에 붙인다.
- 이미지형은 원고 PPT 그림을 "images":["src:장:번호", …](장 = 원고 장표 번호, 번호 = 그 장의 그림 순번)로 준다. 그림이 없는 원고에는 image-*를 쓰지 않는다.
- 제품 소개는 {"layout":"product"|"product-features","product":"제품 이름"} 또는 {"layout":"product","product":"tafa"|"tafa-layers"|"lineup"}.

# 글 규칙(필수)
- 타이틀 title은 두 줄이 이어져 한 문장이 되고 2행이 "~합니다."로 끝난다. 명사구 두 개 나열 금지. 원고 타이틀이 명확하면 내용은 바꾸지 않고 어미만 다듬는다.
- 불릿(body 배열)은 원고 문장을 살린 한 줄, 3개(많아도 4개). "~니다"로 맺지 않고 마침표를 찍지 않는다. 명사형·"~하는 것"·"~함"으로 맺는다. 단어 나열 수준으로 과요약하지 않는다. body를 문자열 하나로 주면 서술형(마침표 유지)이다.
- 마무리 문구 closing·summary·summaries는 슬롯이 있는 장표에서 필수, 문장형 "~합니다."로 두 줄 이내(약 60자). 원고에 없으면 그 장표 내용의 결론을 만들어 넣는다. 메시지형 문장은 짧게.
- 키워드 칩 keywords는 짧게(2~6자), 카탈로그의 칩 개수까지. 없으면 키를 생략한다(도형이 지워진다). caption·tag·arrows·num도 없으면 생략.
- 차트 항목은 5개까지, 비율은 합이 100.
- [[ ]]로 감싼 부분만 강조색이 된다.
- 원고가 4문장 넘는 서술이면 불릿으로 요약하되 원고 내용을 최대한 지킨다.
- 카탈로그의 용량(글자/줄)을 넘기지 않는다. 글자 수는 한글·한자 1, 영문·숫자·기호 0.55, 공백 0.35로 세고 [[ ]] 표시도 약 2자로 센다. 모든 문자열을 용량의 90% 안에 맞춘다 — 특히 카드·항목 제목(title)과 KPI 수치(value)는 한 줄 상자라 짧아야 한다.
- 부서명은 원고에서 파악되면 meta.dept에, 아니면 생략한다(표지에 "부서명"으로 표기된다). 날짜는 지시에 준 오늘 날짜.

# 수정·재생성 규약
- 빌드 오류 수정 요청에는 지시대로 {"slide":{…}} 한 장표만, 장을 나눠야 하면 {"slides":[{…},{…}]}(그 자리에 순서대로 들어간다), 또는 덱 전체 JSON을 낸다.
- 재생성에서 바꾸지 않는 장표는 {"keep": true}로만 적는다(같은 섹션의 같은 순번을 유지한다는 뜻). 섹션을 추가·삭제·순서 변경했으면 그 섹션의 장표는 전부 다시 적는다.`;

function entryLine(e: PptCatalogEntry): string {
  const bits = [`slide ${e.slide ?? "-"}`];
  if (e.arity) bits.push(`항목 ${e.arity}개`);
  if (e.closing) bits.push(e.closing.required ? `마무리 문구 필수·${e.closing.maxLines}줄까지` : `마무리 문구 선택·${e.closing.maxLines}줄까지`);
  if (e.chips) bits.push(`키워드 칩 ${e.chips}개`);
  if (e.required.length) bits.push(`필수: ${e.required.join(", ")}`);
  const cap = [capacityLine(e.capacity), tableLine(e.table)].filter(Boolean).join(" · ");
  return `- ${e.name} (${bits.join(", ")}) — ${e.desc}. ${e.use}\n  ${JSON.stringify(e.example)}${cap ? `\n  용량: ${cap}` : ""}`;
}

/** "표 자리 높이 7.1cm = 머리글 + 한 줄 행 6개(두 줄 행 4개), 폭 27cm ≈ 한 줄 95자(열 합계, 8pt)" */
export function tableLine(t: PptCatalogEntry["table"]): string | null {
  if (!t) return null;
  return `표 자리 높이 ${t.heightCm}cm = 머리글 + 한 줄 행 ${t.rowsOneLine}개(두 줄 행 ${t.rowsTwoLine}개), 폭 ${t.widthCm}cm ≈ 한 줄 ${t.charsPerLine}자(열 합계, 8pt)`;
}

/** "title 15/1 · body 24/4" — 역할 줄당글자/줄수. 없으면 null */
export function capacityLine(cap: Record<string, [number, number]> | undefined): string | null {
  const entries = Object.entries(cap ?? {});
  return entries.length ? entries.map(([role, [cpl, lines]]) => `${role} ${cpl}/${lines}`).join(" · ") : null;
}

export function catalogText(catalog: PptCatalog): string {
  const lines = [
    `# 장표 카탈로그 (템플릿 ${catalog.templateSlides}장 · 본문 ${catalog.layouts.length}종 · 패키지 ${catalog.package})`,
    "각 장표의 예제는 키와 개수만 남긴 골격이다. 문자열 자리 \"…\"를 원고 내용으로 채우고, 리스트 길이는 그대로 지킨다.",
    `용량은 "역할 줄당글자/줄수"(title 15/1 = 한 줄 15자). 역할 title/body/num은 카드·항목의 제목/불릿/번호, desc/value는 KPI 설명/수치, chip은 키워드 칩, closing/summary는 마무리 문구. 모든 장표 공통: ${capacityLine(catalog.capacityCommon) ?? "page_title 47/2 · section_label 20/1"} (page_title = 장표 타이틀 각 행, section_label은 자동).`,
    ...catalog.layouts.map(entryLine),
    entryLine(catalog.message),
    `- product / product-features (제품 소개, 텍스트 없음) — product 값: ${catalog.products.join(", ")} / 개요형: ${catalog.overview.join(", ")}`,
    `  ${catalog.productExample.map((x) => JSON.stringify(x)).join(" ")}`,
  ];
  return lines.join("\n");
}

export function systemBlocks(catalog: PptCatalog): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: RULES_TEXT, cache_control: CACHE },
    { type: "text", text: catalogText(catalog), cache_control: CACHE },
  ];
}

export interface SourceInput { kind: PptSourceKind; text: string }

export function sourceBlock(source: SourceInput): Anthropic.TextBlockParam {
  return { type: "text", text: `[원고 — ${SOURCE_KIND_LABEL[source.kind]}]\n${source.text}`, cache_control: CACHE };
}

export function instructionText(p: { prompt: string; title?: string | null; dept?: string | null; today: string; kind: PptSourceKind }): string {
  const lines = [
    `[지시]`,
    `오늘 날짜: ${p.today} (meta.date에 이 값을 쓴다). meta.ver는 "01".`,
    p.title ? `표지 제목 힌트: ${p.title} (두 줄 문장형으로 다듬어 meta.title에)` : `표지 제목은 원고에서 정한다.`,
    p.dept ? `부서명: ${p.dept} (meta.dept)` : `부서명은 원고에서 파악되면 넣고, 아니면 생략한다.`,
    p.kind === "pptx" ? `원고가 PPT다: 장표 수와 순서를 그대로 유지하고, 그림·도식은 images/source로 가져온다.` : `원고의 목차가 있으면 그대로, 없으면 섹션을 만든다.`,
    p.prompt.trim() ? `사용자 요청: ${p.prompt.trim()}` : `사용자 요청: 없음(원고를 충실히 옮긴다).`,
    `위 규칙과 카탈로그에 맞는 deck JSON 객체 하나만 출력한다.`,
  ];
  return lines.join("\n");
}

export function generateMessages(p: { source: SourceInput; prompt: string; title?: string | null; dept?: string | null; today: string }): Anthropic.MessageParam[] {
  return [{ role: "user", content: [sourceBlock(p.source), { type: "text", text: instructionText({ prompt: p.prompt, title: p.title, dept: p.dept, today: p.today, kind: p.source.kind }) }] }];
}

/** JSON이 아닌 응답이 왔을 때 한 번 더: 이전 응답을 assistant로 붙이고 JSON만 요구한다. */
export function jsonOnlyRetryMessages(prior: Anthropic.MessageParam[], badText: string): Anthropic.MessageParam[] {
  return [...prior, { role: "assistant", content: badText.slice(0, 4000) || "(빈 응답)" }, { role: "user", content: "설명 없이 deck JSON 객체 하나만 다시 출력한다. 마크다운 펜스도 쓰지 않는다." }];
}

/** history: 같은 장표가 앞서 실패한 오류 첫 줄들 — 있으면 글 줄이기 대신 행·항목 수 축소·장표 교체·장 분리로 지시를 올린다 */
export function fixMessages(p: { prior: Anthropic.MessageParam[]; deck: DeckJson; error: PptBuildFail; catalog?: PptCatalog; history?: string[] }): Anthropic.MessageParam[] {
  const where = p.error.section !== null && p.error.slide !== null ? { s: p.error.section, j: p.error.slide } : null;
  const slide = where ? p.deck.sections[where.s]?.slides[where.j] : undefined;
  const layout = slide && !isKeep(slide) ? String(slide.layout) : null;
  const entry = layout ? p.catalog?.layouts.find((e) => e.name === layout) ?? (layout === "message" ? p.catalog?.message : undefined) : undefined;
  const cap = [capacityLine({ ...(entry?.capacity ?? {}), ...(entry?.capacity && p.catalog?.capacityCommon ? p.catalog.capacityCommon : {}) }), tableLine(entry?.table)].filter(Boolean).join(" · ");
  const again = p.history?.length
    ? `\n이 장표는 이미 ${p.history.length}회 고쳤지만 다시 넘쳤다(${p.history.join(" → ")}). 글만 줄이는 방식은 통하지 않았다 — 행·항목 수를 줄이거나, 더 넓은 장표(표는 table-full)로 바꾸거나, {"slides":[{…},{…}]}로 두 장으로 나눈다.`
    : "";
  const ask = where
    ? `섹션 ${where.s + 1} 장표 ${where.j + 1}${layout ? `(${layout})` : ""}에서 빌드 오류가 났다:\n${p.error.message}\n\n이 장표만 고쳐 {"slide": {…}} 형식으로 답한다. 항목 수를 바꿔야 하면 카탈로그의 같은 계열 다른 단 수 장표를 쓴다. 넘침이면 넘친 슬롯만이 아니라 이 장표의 모든 문자열을 용량의 90% 안으로 줄인다(글자 수 세는 법은 규칙과 같다). 다른 장표는 건드리지 않는다.${cap ? `\n이 장표의 용량(역할 줄당글자/줄수): ${cap}` : ""}${again}`
    : `빌드 오류가 났다:\n${p.error.message}\n\n오류를 고친 덱 전체 JSON을 다시 출력한다(keep 금지). 넘침이면 카탈로그 용량의 90% 안으로 줄인다.`;
  return [...p.prior, { role: "assistant", content: JSON.stringify(p.deck) }, { role: "user", content: ask }];
}

export function regenerateMessages(p: { source: SourceInput; baseDeck: DeckJson; feedback: string; today: string; withKeep: boolean }): Anthropic.MessageParam[] {
  const keepRule = p.withKeep
    ? `바꾸지 않는 장표는 {"keep": true}로만 적는다(같은 섹션의 같은 순번을 유지한다는 뜻). 섹션을 추가·삭제·순서 변경했다면 그 섹션 안의 장표는 전부 다시 적는다.`
    : `keep을 쓰지 말고 모든 장표를 다시 적는다.`;
  return [
    { role: "user", content: [sourceBlock(p.source), { type: "text", text: `[지시]\n오늘 날짜: ${p.today}. 아래 덱을 이 원고로 만들었다. 이어지는 피드백을 반영해 다시 만든다.` }] },
    { role: "assistant", content: JSON.stringify(p.baseDeck) },
    { role: "user", content: `피드백: ${p.feedback.trim()}\n\n피드백을 반영한 deck JSON 객체 하나만 출력한다. ${keepRule} meta는 그대로 두되 제목 변경 요청이 있으면 반영한다.` },
  ];
}
