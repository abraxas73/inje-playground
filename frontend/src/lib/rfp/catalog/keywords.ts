import { normalizeText, tokenize } from "../mapping/tokenize";

/** 기능 하나의 키워드 개수 상한 */
export const KEYWORDS_MAX = 20;
/** 키워드 한 항목 길이 상한 */
export const KEYWORD_MAX_LEN = 30;
/** 시드에 넣는 설명 토큰 수 */
export const DESCRIPTION_SEED_MAX = 10;

function accept(k: string): boolean {
  return k.length >= 2 && k.length <= KEYWORD_MAX_LEN;
}

/**
 * 키워드 시드(스펙 §4.4): 이름 토큰 전부 + 설명 토큰 앞 10개(이름 토큰과 중복 제외) + extra(정규화) → 순서 유지 중복 제거 → 20개.
 * extra는 xlsx "키워드" 열처럼 이미 사람이 고른 값이라 토큰화하지 않고 정규화만 한다("single sign-on"처럼 공백을 품을 수 있다).
 */
export function seedKeywords(name: string, description: string, extra: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k: string): boolean => {
    if (!accept(k) || seen.has(k)) return false;
    seen.add(k);
    out.push(k);
    return true;
  };
  for (const t of tokenize(name)) push(t);
  let n = 0;
  for (const t of tokenize(description)) {
    if (n >= DESCRIPTION_SEED_MAX) break;
    if (push(t)) n += 1;
  }
  for (const e of extra) push(normalizeText(e));
  return out.slice(0, KEYWORDS_MAX);
}

/** 어드민 입력(쉼표·전각 쉼표·줄바꿈 구분) → 정규화·2~30자·중복 제거·20개 */
export function parseKeywordInput(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of s.split(/[,、\n]/)) {
    const k = normalizeText(part);
    if (!accept(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= KEYWORDS_MAX) break;
  }
  return out;
}
