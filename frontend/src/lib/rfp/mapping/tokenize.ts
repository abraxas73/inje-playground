/**
 * 규칙 엔진·키워드 시드 공용 토큰화(4단계 스펙 §5.2). 형태소 분석기 없이 정규식과 조사 제거 규칙만 쓴다.
 */

/** 매칭에 도움이 안 되는 일반어. 품질을 보고 코드에서 조정한다. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "기능", "제공", "지원", "관리", "시스템", "사용자", "정보", "및", "등", "있는", "통한", "위한", "대한", "경우", "처리", "가능", "서비스",
  "구성", "환경", "기반", "방식", "형태", "각종", "해당", "관련", "요구", "요구사항", "사업", "본", "사항", "내용", "수행", "필요", "이용", "활용",
  "the", "and", "or", "of", "for", "to", "in", "on", "with", "by",
]);

/** 한글(자모·음절)·라틴 문자·숫자 외 문자 */
const NON_WORD_RE = /[^\p{Script=Hangul}\p{Script=Latin}\p{N}]+/gu;
/** 긴 조사가 앞에 오도록 나열(정규식 대체는 앞에서부터 시도한다) */
const JOSA_RE = /(으로|에서|에게|부터|까지|의|을|를|이|가|은|는|에|로|와|과|도|만)$/u;

export function normalizeText(s: string): string {
  return s.normalize("NFKC").toLowerCase().trim();
}

/** 끝 조사를 한 번 뗀다. 뗀 뒤 2자 미만이면(회의→회, 결과→결) 원문을 돌려준다. */
export function stripJosa(t: string): string {
  const m = JOSA_RE.exec(t);
  if (!m) return t;
  const stem = t.slice(0, t.length - m[0].length);
  return stem.length >= 2 ? stem : t;
}

/** NFKC·소문자 → 기호를 공백으로 → 조사 제거 → 2자 미만·불용어·중복 제거(순서 유지) */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of normalizeText(s).replace(NON_WORD_RE, " ").split(" ")) {
    if (!raw) continue;
    const t = stripJosa(raw);
    if (t.length < 2 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** 공백·기호를 뺀 문자열의 인접 2자 집합. 1자 이하면 빈 집합. */
export function charBigrams(s: string): Set<string> {
  const c = normalizeText(s).replace(NON_WORD_RE, "");
  const out = new Set<string>();
  for (let i = 0; i + 1 < c.length; i++) out.add(c.slice(i, i + 2));
  return out;
}
