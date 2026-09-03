import { cellAt, paragraphTexts, rightOf, topLevelTables, type DocumentModel } from "./document-model";

export interface Overview {
  name: string | null;
  agency: string | null;
  period: string | null;
  budget: string | null;
  bidMethod: string | null;
  /** 라벨 문단 중 위 5개에 속하지 않는 것(2단계 이후 확장용). 1단계는 비워 둔다. */
  extra: Record<string, string>;
}

type Key = "name" | "agency" | "period" | "budget" | "bidMethod";

/** 라벨 정규식(공백 제거 전 원문에 적용, 앞뒤 공백 없는 라벨 문자열) */
const LABELS: { key: Key; re: RegExp }[] = [
  { key: "name", re: /^(?:사업\s*명|과업\s*명|용역\s*명|사업\s*명칭)$/ },
  { key: "period", re: /^(?:사업|용역|계약|과업|수행)\s*기간$/ },
  { key: "budget", re: /^(?:설계\s*금액|사업\s*금액|사업\s*예산|추정\s*가격|기초\s*금액|예산|총\s*사업비|사업비)$/ },
  { key: "bidMethod", re: /^(?:입찰\s*및\s*계약\s*방법|입찰\s*방법|계약\s*방법|입찰\s*방식|계약\s*방식|입찰\s*및\s*계약\s*방식)$/ },
  { key: "agency", re: /^(?:발주\s*기관|수요\s*기관|발주\s*처|주관\s*기관|발주\s*부서|계약\s*기관)$/ },
];
/** 문단 앞 글머리 기호 */
const BULLET = /^[\s□■○◦•\-·ㅇ●▪▶►※◇◆▷]+/;
/** "라벨 : 값" */
const LINE_RE = /^([^:：]{1,24}?)\s*[:：]\s*([\s\S]*)$/;
/** 발주기관 폴백: "한국석유공사(이하 “공사”)" */
const AGENCY_FALLBACK = /([가-힣A-Za-z0-9·]{2,30}?(?:공사|공단|청|부|처|원|진흥원|재단|위원회|특별시|광역시|특별자치시|특별자치도|시|군|구|도|대학교|대학|은행|센터|협회))\s*\(\s*이하\s*[“"'「]/;
/** 표지의 「사업명」·｢사업명｣·“사업명” */
const QUOTED_TITLE = /[「｢“"]\s*([^」｣”"]{4,80}?)\s*[」｣”"]/;

function clean(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

function matchLabel(raw: string): Key | null {
  const label = raw.replace(BULLET, "").trim();
  return LABELS.find((l) => l.re.test(label))?.key ?? null;
}

/** 사업 개요 추출. 규칙 순서: 라벨 문단 → 라벨 표 → 발주기관 "(이하" 폴백 → 표지 인용 사업명. */
export function extractOverview(doc: DocumentModel): Overview {
  const out: Overview = { name: null, agency: null, period: null, budget: null, bidMethod: null, extra: {} };
  const paras = paragraphTexts(doc);

  // 1) 라벨 문단("□ 사업명 : 값" 또는 라벨만 있고 값은 다음 문단)
  for (let i = 0; i < paras.length; i++) {
    const line = paras[i].replace(BULLET, "").trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    const labelText = m ? m[1] : line;
    const key = matchLabel(labelText);
    if (!key || out[key]) continue;
    let value = m ? m[2].trim() : "";
    if (!value) {
      const next = paras[i + 1]?.replace(BULLET, "").trim() ?? "";
      if (next && !matchLabel(next.split(/[:：]/)[0])) value = next;
    }
    if (value) out[key] = clean(value);
  }

  // 2) 라벨 표(왼쪽 셀 라벨 → 오른쪽 셀 값)
  for (const t of topLevelTables(doc)) {
    if (t.cols < 2) continue;
    for (let r = 0; r < t.rows; r++) {
      const label = cellAt(t, r, 0);
      if (!label || label.row !== r) continue;
      const key = matchLabel(label.text);
      if (!key || out[key]) continue;
      const v = rightOf(t, label);
      if (v && v.text.trim()) out[key] = clean(v.text);
    }
  }

  // 3) 발주기관 폴백
  if (!out.agency) {
    for (const text of paras) {
      const m = AGENCY_FALLBACK.exec(text);
      if (m) {
        out.agency = m[1];
        break;
      }
    }
  }

  // 4) 사업명 폴백: 앞 8개 블록의 인용 제목
  if (!out.name) {
    outer: for (const b of doc.blocks.slice(0, 8)) {
      const texts = b.type === "paragraph" ? [b.text] : b.cells.map((c) => c.text);
      for (const t of texts) {
        const m = QUOTED_TITLE.exec(t);
        if (m) {
          out.name = clean(m[1]);
          break outer;
        }
      }
    }
  }
  return out;
}

/** 중복 비교용 사업명: NFKC·소문자·괄호(내용 포함)·공백·기호 제거 */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g, "")
    .replace(/[\s·・,./\\\-_—–「」｢｣『』"'“”‘’:;!?~<>〈〉《》]/g, "");
}

const NAME_NOISE = /(재\s*공고|긴급\s*공고|긴급|수정\s*공고|수정|변경\s*공고|변경|정정\s*공고|정정|재\s*입찰|\d+\s*차)/g;

/** 유사 판단용 사업명: 재공고·긴급·차수 같은 접미 단어를 떼고 정규화 */
export function nameCore(s: string): string {
  return normalizeName(s.replace(NAME_NOISE, " "));
}

/** 중복 비교용 발주기관: (이하 …)·약칭 괄호·법인 표기·공백·기호 제거 */
export function normalizeAgency(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(\s*이하[^)]*\)/g, "")
    .replace(/\([^)]*\)|（[^）]*）/g, "")
    .replace(/(주식회사|㈜|\(주\))/g, "")
    .replace(/[\s·・,./\-_"'“”‘’]/g, "");
}
