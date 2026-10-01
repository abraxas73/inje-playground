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

import { RULES_TEXT } from "./rules-default";
export { RULES_TEXT };

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

/** rules: 운영 설정의 규칙 텍스트(없으면 기본본) */
export function systemBlocks(catalog: PptCatalog, rules: string = RULES_TEXT): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: rules || RULES_TEXT, cache_control: CACHE },
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
