/**
 * deck JSON — 패키지 deck.yaml과 같은 구조. LLM 출력 파싱·정규화·keep 패치·장표 교체.
 * 장표별 키 검증은 하지 않는다: ppt-service 빌드가 패키지 메시지로 정확히 알려 주므로 중복 구현하지 않는다.
 */
import { z } from "zod";

export type DeckMeta = { title: string[]; subtitle?: string; ver?: string; date?: string; dept?: string; author?: string; body_only?: boolean };
export type KeepSlide = { keep: true };
export type SlideJson = ({ layout: string; sub?: string } & Record<string, unknown>) | KeepSlide;
export type SectionJson = { name: string; subs?: string[]; label?: string; slides: SlideJson[] };
export type DeckJson = { meta: DeckMeta; sections: SectionJson[] };

const KeepSchema = z.object({ keep: z.literal(true) }).strict();
const SlideSchema = z.union([KeepSchema, z.object({ layout: z.string().min(1) }).passthrough()]);
const SectionSchema = z.object({
  name: z.string().min(1), subs: z.array(z.string().min(1)).max(5).optional(), label: z.string().optional(), slides: z.array(SlideSchema).min(1),
}).passthrough();
const MetaSchema = z.object({
  title: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(3)]),
  subtitle: z.string().optional(), ver: z.union([z.string(), z.number()]).optional(), date: z.string().optional(),
  dept: z.string().optional(), author: z.string().optional(), body_only: z.boolean().optional(),
}).passthrough();
export const DeckJsonSchema = z.object({ meta: MetaSchema, sections: z.array(SectionSchema).min(1).max(8) });
type RawDeck = z.infer<typeof DeckJsonSchema>;

export class DeckParseError extends Error { constructor(message: string) { super(message); this.name = "DeckParseError"; } }

/** 펜스·설명 문장을 벗기고 첫 `{`부터 마지막 `}`까지만 남긴다. */
export function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new DeckParseError("응답에 JSON 객체가 없습니다.");
  return text.slice(start, end + 1);
}

function parseObject(text: string): unknown {
  try { return JSON.parse(extractJsonObject(text)); } catch (e) {
    if (e instanceof DeckParseError) throw e;
    throw new DeckParseError("응답이 올바른 JSON이 아닙니다.");
  }
}

export function parseDeckJson(text: string, today: string): DeckJson {
  const r = DeckJsonSchema.safeParse(parseObject(text));
  if (!r.success) throw new DeckParseError(`deck JSON 형식 오류: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return normalizeMeta(r.data, today);
}

const DATE_PARTS = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/;

export function normalizeMeta(raw: RawDeck, today: string): DeckJson {
  const m = raw.meta;
  const title = Array.isArray(m.title) ? m.title : [m.title];
  const ver = m.ver === undefined ? "01" : String(m.ver).padStart(2, "0");
  const dm = DATE_PARTS.exec(m.date ?? "");
  const date = dm ? `${dm[1]}. ${dm[2].padStart(2, "0")}. ${dm[3].padStart(2, "0")}` : today;
  const meta: DeckMeta = { ...m, title, ver, date };
  return { meta, sections: raw.sections as SectionJson[] };
}

/** 수정 응답 `{"slide": {...}}` → 장표 하나, `{"slides": [...]}` → 장 분리(1~4장이 그 자리에 들어간다) */
export function parseSlidePatch(text: string): SlideJson[] {
  const obj = parseObject(text) as { slide?: unknown; slides?: unknown };
  const raw = Array.isArray(obj?.slides) ? obj.slides : obj?.slide !== undefined ? [obj.slide] : [];
  const r = z.array(SlideSchema).min(1).max(4).safeParse(raw);
  if (!r.success || r.data.some((s) => isKeep(s as SlideJson))) throw new DeckParseError("수정 응답에 slide 객체가 없습니다.");
  return r.data as SlideJson[];
}

export function isKeep(s: SlideJson): s is KeepSlide { return (s as KeepSlide).keep === true; }
export function hasKeep(deck: DeckJson): boolean { return deck.sections.some((s) => s.slides.some(isKeep)); }

/** keep 장표를 기준 버전의 같은 (섹션, 순번)으로 채운다. 위치가 없으면 실패 사유를 돌려준다. */
export function applyKeep(deck: DeckJson, base: DeckJson): { ok: true; deck: DeckJson } | { ok: false; reason: string } {
  const sections: SectionJson[] = [];
  for (const [si, sec] of deck.sections.entries()) {
    const slides: SlideJson[] = [];
    for (const [sj, sl] of sec.slides.entries()) {
      if (!isKeep(sl)) { slides.push(sl); continue; }
      const prev = base.sections[si]?.slides[sj];
      if (!prev || isKeep(prev)) return { ok: false, reason: `섹션 ${si + 1} 장표 ${sj + 1}의 keep에 대응하는 이전 장표가 없습니다.` };
      slides.push(prev);
    }
    sections.push({ ...sec, slides });
  }
  return { ok: true, deck: { meta: deck.meta, sections } };
}

/** (섹션, 순번)의 장표를 next로 바꾼다. 배열이면 그 자리에 여러 장이 들어간다(장 분리). */
export function replaceSlide(deck: DeckJson, section: number, slide: number, next: SlideJson | SlideJson[]): DeckJson {
  const sec = deck.sections[section];
  if (!sec || slide < 0 || slide >= sec.slides.length) throw new RangeError(`장표 위치가 없습니다: 섹션 ${section} 장표 ${slide}`);
  const list = Array.isArray(next) ? next : [next];
  const sections = deck.sections.map((s, i) => (i === section ? { ...s, slides: [...s.slides.slice(0, slide), ...list, ...s.slides.slice(slide + 1)] } : s));
  return { meta: deck.meta, sections };
}

export function deckTitle(deck: DeckJson): string {
  return deck.meta.title.join(" ").replace(/\s+/g, " ").trim() || "제목 없음";
}

/** 파일명에 못 쓰는 문자를 _로. 비면 deck */
export function safeFileName(title: string): string {
  const s = title.replace(/[\\/:*?"<>|]/g, "_").trim();
  return s || "deck";
}

/** KST 기준 `YYYY. MM. DD`(표지 날짜 형식) */
export function todayLabel(date: Date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear(), m = String(kst.getUTCMonth() + 1).padStart(2, "0"), d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}. ${m}. ${d}`;
}
