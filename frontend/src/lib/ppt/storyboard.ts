/** deck JSON → 구성 보기 뷰 모델. 장표별 키를 다 알지 않고, 알려진 그룹·문구 키를 순서대로 뽑는 제너릭 변환. */
import { isKeep, type DeckJson, type SlideJson } from "./deck-json";

export interface StoryItem { title: string | null; body: string[] }
export interface StoryGroup { label: string; items: StoryItem[] }
export interface StorySlide { section: number; index: number; layout: string; title: string[]; groups: StoryGroup[]; footer: string[] }
export interface StorySection { name: string; subs: string[]; slides: StorySlide[] }

const GROUP_KEYS = ["cards", "items", "steps", "steps2", "panels", "kpis", "kpi", "notes", "lower", "lower_cards", "rows", "right", "left", "tables", "summaries", "mid_notes"] as const;
const TITLE_KEYS = ["num", "pill", "header", "label", "title", "desc"] as const;
const BODY_KEYS = ["body", "detail", "text", "value", "summary", "sub"] as const;
const FOOTER_KEYS = ["headline", "lead", "center", "closing", "summary", "detail", "caption", "panel_title", "panel_head", "center_head"] as const;

const asLines = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)]);

function itemOf(v: unknown): StoryItem {
  if (typeof v === "string" || typeof v === "number") return { title: null, body: [String(v)] };
  if (Array.isArray(v)) {
    // 표 행·격자 행: 셀이 객체면 셀마다 항목, 문자열이면 한 줄로 합친다
    if (v.every((c) => typeof c === "object" && c !== null)) return { title: null, body: v.flatMap((c) => { const it = itemOf(c); return it.title ? [`${it.title}: ${it.body.join(" ")}`] : it.body; }) };
    return { title: null, body: [v.map(String).join(" | ")] };
  }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const title = TITLE_KEYS.map((k) => o[k]).filter((x) => typeof x === "string" || typeof x === "number").map(String).join(" ") || null;
    const body = BODY_KEYS.flatMap((k) => (k === "sub" && title ? [] : asLines(o[k])));
    if (Array.isArray(o.header) && Array.isArray(o.rows)) {
      return { title, body: [asLines(o.header).join(" | "), ...(o.rows as unknown[]).map((r) => asLines(r).join(" | "))] };
    }
    return { title, body };
  }
  return { title: null, body: [] };
}

function slideOf(sl: SlideJson, section: number, index: number): StorySlide {
  if (isKeep(sl)) return { section, index, layout: "(이전 버전 유지)", title: [], groups: [], footer: [] };
  const o = sl as Record<string, unknown>;
  const title = sl.layout === "message" ? asLines(o.headline) : asLines(o.title);
  const groups: StoryGroup[] = [];
  for (const key of GROUP_KEYS) {
    const v = o[key];
    if (!Array.isArray(v) || !v.length) continue;
    groups.push({ label: key, items: (v as unknown[]).map(itemOf) });
  }
  const chart = o.chart as { categories?: unknown[]; values?: unknown[] } | undefined;
  if (chart?.categories && chart?.values) {
    groups.push({ label: "chart", items: [{ title: null, body: chart.categories.map((c, i) => `${String(c)}: ${String(chart.values?.[i] ?? "")}`) }] });
  }
  const note = o.note as { title?: string; body?: unknown } | undefined;
  if (note) groups.push({ label: "note", items: [{ title: note.title ?? null, body: asLines(note.body) }] });
  const footer = FOOTER_KEYS.filter((k) => !(sl.layout === "message" && k === "headline")).flatMap((k) => asLines(o[k]));
  return { section, index, layout: sl.layout, title, groups, footer };
}

export function storyboard(deck: DeckJson): StorySection[] {
  return deck.sections.map((sec, si) => ({ name: sec.name, subs: sec.subs ?? [], slides: sec.slides.map((sl, sj) => slideOf(sl, si, sj)) }));
}
