/** 요청 본문 검증(순수 함수). 라우트는 결과를 그대로 응답으로 바꾼다. */
import { PPT_MODEL_OPTIONS, type PptSourceKind } from "@/types/ppt";
import { extensionOf, sourceKindFor, sourceLengthError } from "./source";
import { SOURCE_PATH_RE } from "./store";

export const PROMPT_MAX = 2000;
const TITLE_MAX = 120;
const DEPT_MAX = 60;

type Fail = { ok: false; status: number; error: string };
export type CreateParsed =
  | { ok: true; kind: PptSourceKind; text: string | null; storagePath: string | null; fileName: string | null; prompt: string; title: string | null; dept: string | null; model: string | null; templateId: string | null }
  | Fail;

const fail = (error: string, status = 400): Fail => ({ ok: false, status, error });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function parseCreateRequest(body: unknown): CreateParsed {
  if (!body || typeof body !== "object") return fail("요청 본문이 없습니다.");
  const b = body as Record<string, unknown>;
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (prompt.length > PROMPT_MAX) return fail(`프롬프트는 ${PROMPT_MAX.toLocaleString("ko-KR")}자 이하여야 합니다.`);
  const title = str(b.title, TITLE_MAX);
  const dept = str(b.dept, DEPT_MAX);
  const model = str(b.model, 60);
  if (model && !PPT_MODEL_OPTIONS.some((o) => o.id === model)) return fail("선택할 수 없는 모델입니다.");
  const templateId = str(b.templateId, 40);
  if (templateId && !UUID_RE.test(templateId)) return fail("templateId가 올바르지 않습니다.");
  const text = typeof b.text === "string" ? b.text : null;
  const storagePath = typeof b.storagePath === "string" ? b.storagePath : null;
  const fileName = typeof b.fileName === "string" ? b.fileName.trim() : null;
  if (text !== null && storagePath) return fail("텍스트와 파일 중 하나만 보내세요.");
  if (text !== null) {
    const err = sourceLengthError(text);
    if (err) return fail(err);
    return { ok: true, kind: "text", text, storagePath: null, fileName: null, prompt, title, dept, model, templateId };
  }
  if (!storagePath || !fileName) return fail("원고를 입력하거나 파일을 올려 주세요.");
  if (!SOURCE_PATH_RE.test(storagePath)) return fail("업로드 경로가 올바르지 않습니다. 파일을 다시 올려 주세요.");
  if (storagePath.slice(storagePath.lastIndexOf(".") + 1) !== extensionOf(fileName)) return fail("파일 확장자가 업로드와 다릅니다.");
  return { ok: true, kind: sourceKindFor(fileName), text: null, storagePath, fileName, prompt, title, dept, model, templateId };
}

/** 덱 목록·머리글에 완성 전부터 보일 임시 제목: 입력한 표지 제목 → 파일명(확장자 제외) → 원고 첫 줄. 완성되면 표지 제목으로 바뀐다. */
export function provisionalTitle(p: { title: string | null; fileName: string | null; text: string | null }): string {
  if (p.title) return p.title;
  if (p.fileName) return p.fileName.replace(/\.[^.]+$/, "").trim().slice(0, TITLE_MAX);
  const line = (p.text ?? "").split("\n").map((l) => l.replace(/^[#\s*\->]+/, "").trim()).find((l) => l);
  return (line ?? "").replace(/\s+/g, " ").slice(0, 80);
}

export type RegenerateParsed = { ok: true; retry: boolean; feedback: string | null; baseVersion: number | null } | Fail;

export function parseRegenerateRequest(body: unknown): RegenerateParsed {
  if (!body || typeof body !== "object") return fail("요청 본문이 없습니다.");
  const b = body as Record<string, unknown>;
  if (b.retry === true) return { ok: true, retry: true, feedback: null, baseVersion: null };
  const feedback = typeof b.feedback === "string" ? b.feedback.trim() : "";
  if (!feedback) return fail("피드백을 입력하세요.");
  if (feedback.length > PROMPT_MAX) return fail(`피드백은 ${PROMPT_MAX.toLocaleString("ko-KR")}자 이하여야 합니다.`);
  let baseVersion: number | null = null;
  if (b.baseVersion !== undefined && b.baseVersion !== null) {
    if (typeof b.baseVersion !== "number" || !Number.isInteger(b.baseVersion) || b.baseVersion < 1) return fail("baseVersion이 올바르지 않습니다.");
    baseVersion = b.baseVersion;
  }
  return { ok: true, retry: false, feedback, baseVersion };
}
