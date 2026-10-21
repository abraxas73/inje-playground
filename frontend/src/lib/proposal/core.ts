/**
 * 제안도우미-일반현황 — 순수 로직(DB·네트워크 없음). 스펙 docs/superpowers/specs/2026-10-20-proposal-general-design.md
 */
export const PROPOSAL_BUCKET = "ppt";
export const PROPOSAL_MODES = ["restyle", "reflow"] as const;
export type ProposalMode = (typeof PROPOSAL_MODES)[number];
export const MODE_LABEL: Record<ProposalMode, string> = { restyle: "모양 유지", reflow: "레이아웃 재구성" };
export const PROFILE_MAX_BYTES = 50 * 1024 * 1024;
export const TEMPLATE_MAX_BYTES = 20 * 1024 * 1024;
export const STALE_MS = 15 * 60 * 1000;

export const PROFILE_COLUMNS = "id, title, as_of, file_name, slide_count, uploaded_by, uploader_name, hidden, created_at";
export const JOB_COLUMNS = "id, owner_id, owner_name, project_name, profile_id, template_name, mode, status, slide_count, error, share_enabled, created_at, finished_at";

export interface ProfileRow { id: string; title: string; as_of: string | null; file_name: string; slide_count: number; uploaded_by: string; uploader_name: string | null; hidden: boolean; created_at: string }
export interface JobRow { id: string; owner_id: string; owner_name: string | null; project_name: string; profile_id: string; template_name: string; mode: ProposalMode; status: "queued" | "running" | "done" | "failed"; slide_count: number | null; error: string | null; share_enabled: boolean; created_at: string; finished_at: string | null }

/** 업로드 파일 종류: profile(일반현황)은 pptx, template(고객사)는 pptx·potx */
export function uploadExtension(fileName: string, kind: "profile" | "template"): string | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pptx") return ext;
  if (kind === "template" && ext === "potx") return ext;
  return null;
}
export const profilePath = (id: string) => `proposal/profiles/${id}.pptx`;
export const templatePath = (id: string, ext: string) => `proposal/templates/${id}.${ext}`;
export const resultPath = (jobId: string) => `proposal/results/${jobId}.pptx`;
/** 일반현황 미리보기 — 앞 3장 JPEG(올린 사람의 브라우저가 그려 올린다) */
export const PREVIEW_COUNT = 3;
export const previewPath = (profileId: string, n: number) => `proposal/previews/${profileId}/${n}.jpg`;

/** 업로드 직후 받은 경로가 그 종류의 우리 경로인지(다른 사람 파일·임의 경로로 바꿔치기 방지) */
export function isOwnUploadPath(path: unknown, kind: "profile" | "template"): path is string {
  if (typeof path !== "string") return false;
  return kind === "profile"
    ? /^proposal\/profiles\/[0-9a-f-]{36}\.pptx$/.test(path)
    : /^proposal\/templates\/[0-9a-f-]{36}\.(pptx|potx)$/.test(path);
}

export function cleanName(v: unknown, max = 100): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f]/g, " ").trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

/** 최신 = 숨기지 않은 것 중 가장 나중에 올린 것 */
export function latestProfile<T extends Pick<ProfileRow, "hidden" | "created_at">>(rows: T[]): T | null {
  return rows.filter((r) => !r.hidden).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

/** 다운로드 파일 이름 — 프로젝트명_일반현황.pptx(파일 이름에 못 쓰는 글자는 _) */
export function resultFileName(projectName: string): string {
  return `${projectName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80)}_일반현황.pptx`;
}

// ── 레이아웃 재구성(reflow) ────────────────────────────────────

export interface OutlineSlide { no: number; title: string | null; texts: string[]; tables: string[][][]; images: { id: string; w: number; h: number }[] }
export interface TemplateLayout { index: number; name: string; placeholders: { idx: number; kind: string; x: number; y: number; w: number; h: number }[] }
export interface TemplateInfo { widthCm: number; heightCm: number; layouts: TemplateLayout[] }
export interface ReflowSlide { layout: number; title: string; body?: (string | { text: string; level?: number })[]; table?: { header?: string[]; rows: string[][] }; images?: string[] }
export interface ReflowSpec { slides: ReflowSlide[] }

export const REFLOW_SYSTEM = `당신은 제안서 편집자다. 회사 일반현황 PPT의 내용을 고객사 PowerPoint 템플릿의 레이아웃에 옮겨 담는 배치표(JSON)를 만든다.
규칙:
1. 내용은 일반현황 원문에 있는 것만 쓴다. 숫자·연도·금액·인원·고객사명·인증명은 원문 그대로(바꾸거나 반올림·추정하지 않는다). 새 사실을 만들지 않는다.
2. 일반현황 장표 순서를 지킨다. 한 장이 너무 많으면 같은 제목에 "(계속)"을 붙여 나눈다. 장을 합치지 않는다.
3. 레이아웃은 고객사 템플릿 목록의 index로 고른다 — 제목 자리(title)가 있는 레이아웃을 쓴다. 표가 있는 장은 본문 자리(body)가 넓은 레이아웃, 그림만 있는 장은 picture 자리가 있으면 그것.
4. 본문은 짧은 문장 목록(body). 한 장에 8줄 이하, 하위 항목은 level 1.
5. 표는 원문 표를 그대로 옮긴다(table.header + table.rows, 행 14개 이하 — 넘치면 장을 나눔).
6. 그림은 원문 그림 id(예: "s3-1")로만 고른다(images). 원문에 없는 id는 쓰지 않는다.
출력: JSON 하나만 — {"slides":[{"layout":번호,"title":"...","body":[...],"table":{...},"images":[...]}]} 설명·코드블록 표시 없이.`;

export function reflowUserMessage(profile: OutlineSlide[], template: TemplateInfo): string {
  return `고객사 템플릿(슬라이드 ${template.widthCm}×${template.heightCm}cm) 레이아웃:\n${JSON.stringify(template.layouts)}\n\n일반현황 장표:\n${JSON.stringify(profile)}`;
}

/** 모델 출력에서 JSON을 꺼내 모양을 검사한다. 맞지 않으면 null */
export function parseReflowSpec(text: string, layoutCount: number, imageIds: Set<string>): ReflowSpec | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const slides = (raw as { slides?: unknown })?.slides;
  if (!Array.isArray(slides) || slides.length < 1 || slides.length > 80) return null;
  const out: ReflowSlide[] = [];
  for (const s of slides) {
    if (!s || typeof s !== "object") return null;
    const o = s as Record<string, unknown>;
    if (!Number.isInteger(o.layout) || (o.layout as number) < 0 || (o.layout as number) >= layoutCount || typeof o.title !== "string") return null;
    const slide: ReflowSlide = { layout: o.layout as number, title: o.title.slice(0, 200) };
    if (Array.isArray(o.body)) slide.body = o.body.filter((b) => typeof b === "string" || (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string")).slice(0, 20) as ReflowSlide["body"];
    if (o.table && typeof o.table === "object") {
      const t = o.table as { header?: unknown; rows?: unknown };
      const rows = Array.isArray(t.rows) ? t.rows.filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? ""))) : [];
      if (rows.length) slide.table = { header: Array.isArray(t.header) ? t.header.map((c) => String(c ?? "")) : undefined, rows: rows.slice(0, 30) };
    }
    if (Array.isArray(o.images)) slide.images = o.images.filter((i): i is string => typeof i === "string" && imageIds.has(i)).slice(0, 4);
    out.push(slide);
  }
  return { slides: out };
}

const NUMBER_RE = /\d[\d,.]*/g;
/** 배치표의 숫자 중 일반현황 원문에 없는 것 — 모델이 숫자를 지어내거나 바꾸면 생성 실패로 돌린다 */
export function inventedNumbers(spec: ReflowSpec, profile: OutlineSlide[]): string[] {
  const norm = (s: string) => s.replace(/,/g, "");
  const source = new Set<string>();
  for (const s of profile) for (const t of [s.title ?? "", ...s.texts, ...s.tables.flat(2)]) for (const m of t.match(NUMBER_RE) ?? []) source.add(norm(m).replace(/\.$/, ""));
  const bad = new Set<string>();
  for (const s of spec.slides) {
    const texts = [s.title, ...(s.body ?? []).map((b) => (typeof b === "string" ? b : b.text)), ...(s.table?.header ?? []), ...(s.table?.rows.flat() ?? [])];
    for (const t of texts) for (const m of t.match(NUMBER_RE) ?? []) {
      const n = norm(m).replace(/\.$/, "");
      if (n && !source.has(n)) bad.add(m);
    }
  }
  return [...bad];
}
