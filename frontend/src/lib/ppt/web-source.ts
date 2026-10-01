/**
 * URL 원고 — 서버가 웹 페이지를 받아 본문 텍스트를 뽑는다(순수 함수 + fetch 한 겹).
 * SSRF: https·공개 도메인만(알림 웹훅과 같은 가드), 리다이렉트는 홉마다 다시 검사. HTML은 정규식으로 본문만 남긴다(의존성 없음).
 * PDF·DOCX 링크는 기존 문서 추출기를 재사용한다.
 */
import { checkWebhookUrl, type UrlCheck } from "@/lib/notify/url-guard";
import { SOURCE_MAX_CHARS, type PptSourceImage } from "@/types/ppt";
import { textFromDocument } from "./source";

export const URL_FETCH_TIMEOUT_MS = 20_000;
export const URL_MAX_BYTES = 10 * 1024 * 1024;
const MAX_HOPS = 3;
const UA = "Mozilla/5.0 (compatible; InnogridPptMaker/1.0; +https://inje-playground.vercel.app)";

export class UrlSourceError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); this.name = "UrlSourceError"; }
}

/** https + 공개 도메인 호스트. 가드의 웹훅 문구만 원고용으로 바꾼다. */
export function checkSourceUrl(raw: unknown): UrlCheck {
  const r = checkWebhookUrl(raw);
  if (r.ok) return r;
  if (r.error.includes("사내망")) return { ok: false, error: "사내망·로컬 주소는 가져올 수 없습니다. 외부에서 접근되는 https 주소를 넣어 주세요." };
  if (r.error.startsWith("URL을 입력")) return { ok: false, error: "웹 주소를 입력하세요." };
  return r;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", middot: "·", bull: "•", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

const DROP_TAGS = ["script", "style", "noscript", "svg", "template", "iframe", "canvas", "form", "button", "nav", "footer", "header", "aside"];
export const MAX_SOURCE_IMAGES = 12;
const MIN_IMAGE_PX = 120;
const JUNK_IMAGE_RE = /icon|logo|avatar|emoji|sprite|pixel|spinner|badge|button|favicon|tracking|blank\.gif|1x1/i;
const dropRe = (tag: string) => new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");

/** 본문 후보: <main>·<article> 중 가장 긴 것(글이 200자 넘을 때). 없으면 <body> 전체. */
function pickBody(html: string): string {
  let best = "";
  for (const tag of ["article", "main"]) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
    for (const m of html.matchAll(re)) if (m[1].length > best.length) best = m[1];
  }
  if (best && stripTags(best).trim().length > 200) return best;
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html);
  return body ? body[1] : html;
}

// 따옴표 속성 안의 ">"(위키백과 data-mw 등)에서 끊기지 않게 속성 단위로 태그를 읽는다
const TAG_RE = /<\/?[a-zA-Z][^\s/>]*(?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g;
function stripTags(s: string): string { return s.replace(TAG_RE, ""); }

const ATTR_RE = /([^\s=>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR_RE)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

/** 본문 안의 <img>를 골라 목록으로 만들고 그 자리에 [이미지 N: 설명] 표시를 남긴다. 작은 아이콘·로고·추적 픽셀·data: URI는 뺀다. lazy 로딩(data-src·srcset)도 본다. */
export function extractImages(body: string, baseUrl: string | undefined): { body: string; images: PptSourceImage[] } {
  const images: PptSourceImage[] = [];
  const seen = new Set<string>();
  const out = body.replace(/<img\b[^>]*?(?:"[^"]*"[^>]*?|'[^']*'[^>]*?)*\/?>/gi, (tag) => {
    const a = attrsOf(tag);
    let src = a["data-src"] || a["data-original"] || a["data-lazy-src"] || "";
    if (!src || src.startsWith("data:")) src = a.src && !a.src.startsWith("data:") ? a.src : "";
    if (!src && a.srcset) src = a.srcset.split(",")[0]?.trim().split(/\s+/)[0] ?? "";
    if (!src || src.startsWith("data:")) return "";
    let abs: string;
    try { abs = new URL(src, baseUrl).toString(); } catch { return ""; }
    if (!/^https?:/i.test(abs)) return "";
    const w = Number.parseInt(a.width ?? "", 10), h = Number.parseInt(a.height ?? "", 10);
    if ((Number.isFinite(w) && w < MIN_IMAGE_PX) || (Number.isFinite(h) && h < MIN_IMAGE_PX)) return "";
    if (JUNK_IMAGE_RE.test(abs.split("?")[0]) && !(Number.isFinite(w) && w >= 400)) return "";
    if (seen.has(abs) || images.length >= MAX_SOURCE_IMAGES) return "";
    seen.add(abs);
    const alt = (a.alt ?? "").replace(/\s+/g, " ").trim() || null;
    images.push({ url: abs, alt, width: Number.isFinite(w) ? w : null, height: Number.isFinite(h) ? h : null });
    return `\n[이미지 ${images.length}${alt ? `: ${alt}` : ""}]\n`;
  });
  return { body: out, images };
}

/** HTML → 제목과 마크다운 비슷한 본문(제목 #, 목록 -, 표는 셀을 |로). images=true면 본문 이미지를 뽑고 자리에 [이미지 N] 표시를 남긴다. */
export function htmlToText(html: string, opts: { images?: boolean; baseUrl?: string } = {}): { title: string | null; text: string; images: PptSourceImage[] } {
  const titleM = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title = titleM ? decodeEntities(stripTags(titleM[1])).replace(/\s+/g, " ").trim() || null : null;
  let s = html.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, "");
  for (const t of DROP_TAGS) s = s.replace(dropRe(t), "");
  s = pickBody(s);
  let images: PptSourceImage[] = [];
  if (opts.images) ({ body: s, images } = extractImages(s, opts.baseUrl));
  s = s.replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Number(n))} `).replace(/<\/h[1-6]\s*>/gi, "\n\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/(?:li)\s*>/gi, "");
  s = s.replace(/<(?:br)\b[^>]*\/?>/gi, "\n");
  s = s.replace(/<\/(?:tr)\s*>/gi, "\n").replace(/<\/(?:td|th)\s*>/gi, " | ");
  s = s.replace(/<\/?(?:p|div|section|blockquote|pre|table|thead|tbody|ul|ol|dl|dt|dd|address|hr)\b[^>]*>/gi, "\n");
  s = decodeEntities(stripTags(s));
  const lines = s.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").replace(/\s*\|\s*$/, "").trim());
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text, images };
}

/** Content-Type·<meta charset>에서 문자셋을 찾아 디코드. 모르면 UTF-8. */
export function decodeBody(buf: ArrayBuffer, contentType: string | null, sniffHtml: boolean): string {
  let label = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  if (!label && sniffHtml) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
    label = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try { return new TextDecoder((label ?? "utf-8").toLowerCase()).decode(buf); }
  catch { return new TextDecoder("utf-8").decode(buf); }
}

/** 60,000자 상한에서 자르고 잘린 사실을 끝에 적는다 — LLM과 사용자(원문 보기)가 함께 본다. */
export function clampSourceText(text: string): string {
  if (text.length <= SOURCE_MAX_CHARS) return text;
  const note = `\n\n[이하 생략 — 원문 ${text.length.toLocaleString("ko-KR")}자 중 ${SOURCE_MAX_CHARS.toLocaleString("ko-KR")}자까지만 가져왔습니다]`;
  return text.slice(0, SOURCE_MAX_CHARS - note.length) + note;
}

export interface FetchedUrlSource { text: string; title: string | null; finalUrl: string; contentType: string; images: PptSourceImage[] }

/** 주소를 받아 본문 텍스트로. 실패는 UrlSourceError(사용자에게 그대로 보여 줄 문구). */
export async function fetchUrlSource(url: string, fetchImpl: typeof fetch = fetch, opts: { images?: boolean } = {}): Promise<FetchedUrlSource> {
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const check = checkSourceUrl(current);
    if (!check.ok) throw new UrlSourceError(hop === 0 ? check.error : `리다이렉트된 주소를 가져올 수 없습니다: ${check.error}`);
    let res: Response;
    try {
      res = await fetchImpl(check.url, { redirect: "manual", signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS), headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5", "Accept-Language": "ko,en;q=0.8" } });
    } catch (e) {
      throw new UrlSourceError(`페이지를 가져오지 못했습니다(${e instanceof Error && e.name === "TimeoutError" ? "시간 초과" : "연결 오류"}).`, 502);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new UrlSourceError("리다이렉트 주소가 없습니다.", 502);
      current = new URL(loc, check.url).toString();
      continue;
    }
    if (!res.ok) throw new UrlSourceError(`페이지가 ${res.status}을(를) 돌려주었습니다. 로그인이 필요하거나 없는 주소일 수 있습니다.`, 502);
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > URL_MAX_BYTES) throw new UrlSourceError("페이지가 10MB를 넘습니다.");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > URL_MAX_BYTES) throw new UrlSourceError("페이지가 10MB를 넘습니다.");
    const path = new URL(check.url).pathname.toLowerCase();
    if (contentType.includes("application/pdf") || path.endsWith(".pdf")) {
      return { text: await textFromDocument(Buffer.from(buf), "page.pdf"), title: null, finalUrl: check.url, contentType, images: [] };
    }
    if (contentType.includes("officedocument.wordprocessingml") || path.endsWith(".docx")) {
      return { text: await textFromDocument(Buffer.from(buf), "page.docx"), title: null, finalUrl: check.url, contentType, images: [] };
    }
    const isHtml = contentType.includes("html") || contentType.includes("xml") || (!contentType && /<html|<body|<div|<p\b/i.test(new TextDecoder("latin1").decode(buf.slice(0, 2048))));
    if (isHtml) {
      const { title, text, images } = htmlToText(decodeBody(buf, contentType, true), { images: opts.images, baseUrl: check.url });
      if (text.length < 50) throw new UrlSourceError("페이지에서 글을 거의 찾지 못했습니다. 로그인 뒤에만 보이거나 스크립트로만 그려지는 페이지일 수 있습니다 — 내용을 복사해 텍스트 원고로 넣어 주세요.");
      return { text, title, finalUrl: check.url, contentType, images };
    }
    if (contentType.startsWith("text/")) {
      const text = decodeBody(buf, contentType, false).trim();
      if (text.length < 50) throw new UrlSourceError("페이지에서 글을 거의 찾지 못했습니다.");
      return { text, title: null, finalUrl: check.url, contentType, images: [] };
    }
    throw new UrlSourceError(`지원하지 않는 콘텐츠 형식입니다(${contentType || "알 수 없음"}). 웹 페이지·PDF·DOCX 주소만 가져올 수 있습니다.`, 415);
  }
  throw new UrlSourceError("리다이렉트가 너무 많습니다.", 502);
}

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp", "image/tiff": "tiff", "image/avif": "avif" };

/** 이미지 한 장을 받아 {bytes, contentType, ext}로. 가드는 페이지와 같다(https·공개 호스트). 실패는 UrlSourceError. */
export async function fetchImage(url: string, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Buffer; contentType: string; ext: string }> {
  const check = checkSourceUrl(url);
  if (!check.ok) throw new UrlSourceError(check.error);
  let res: Response;
  try { res = await fetchImpl(check.url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": UA, Accept: "image/*" } }); }
  catch { throw new UrlSourceError("이미지를 가져오지 못했습니다.", 502); }
  if (!res.ok) throw new UrlSourceError(`이미지 응답 ${res.status}`, 502);
  const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_EXT[ct] ?? (/\.(png|jpe?g|gif|webp|bmp|tiff?|avif)(?:$|\?)/i.exec(check.url)?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? null);
  if (!ext) throw new UrlSourceError(`이미지가 아닙니다(${ct || "형식 불명"})`, 415);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > IMAGE_MAX_BYTES) throw new UrlSourceError("이미지가 비었거나 8MB를 넘습니다.");
  return { bytes: buf, contentType: ct || `image/${ext === "jpg" ? "jpeg" : ext}`, ext };
}
