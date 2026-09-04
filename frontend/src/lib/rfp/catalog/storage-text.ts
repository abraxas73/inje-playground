/**
 * Confluence storage 포맷(XHTML + ac:/ri: 네임스페이스) → 평문(스펙 §3.2).
 * XML 파서 대신 정규식을 쓴다 — storage 본문은 HTML 엔티티와 닫히지 않은 태그가 섞여 파서가 자주 실패한다.
 */
const NAMED: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/** 내용까지 지우는 요소 */
const DROP = "ac:image|ri:[\\w-]+|ac:parameter|script|style";
/** 태그만 벗기고 줄바꿈으로 바꾸는 블록 요소 */
const BLOCK = "p|div|ul|ol|table|thead|tbody|tfoot|blockquote|pre|section|ac:structured-macro|ac:rich-text-body|ac:plain-text-body|ac:layout|ac:layout-section|ac:layout-cell";

export function storageToText(xhtml: string): string {
  let s = xhtml;
  // 1. 주석·CDATA·내용까지 지울 요소
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // CDATA에서 나온 "x < 1"처럼 태그가 아닌 '<'는 엔티티로 바꿔 stripTags가 삼키지 않게 한다
  s = s.replace(/<(?![a-zA-Z/!?])/g, "&lt;");
  s = s.replace(new RegExp(`<(${DROP})\\b[^>]*\\/>`, "gi"), "");
  s = s.replace(new RegExp(`<(${DROP})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi"), "");
  // 2. 표: 행마다 한 줄 "| a | b |"
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_m, inner: string) => {
    const cells = [...inner.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      stripTags(c[1].replace(/<br\s*\/?>/gi, " ")).replace(/\s+/g, " ").trim(),
    );
    return `\n| ${cells.join(" | ")} |\n`;
  });
  // 3. 블록 요소 → 줄바꿈·접두. 줄바꿈은 넉넉히 넣고 4단계에서 빈 줄을 모두 지운다(LLM 입력이라 단락 간 빈 줄은 필요 없다).
  s = s.replace(/<h[1-6]\b[^>]*>/gi, "\n# ").replace(/<\/h[1-6]>/gi, "\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(new RegExp(`<\\/?(${BLOCK})\\b[^>]*>`, "gi"), "\n");
  s = stripTags(s);
  s = decodeEntities(s);
  // 4. 공백 정리: 줄 안 연속 공백(nbsp 포함) → 하나, 빈 줄 제거
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
