/**
 * 요구사항 총괄표(요구사항 구분 · ID 부여규칙 · 요구사항 수) — 구분 코드 → 분류명 매칭. 순수 함수(클라이언트·서버 공용).
 * 부여규칙은 "SER-000", "INR-DTL-000"처럼 코드 뒤에 0이 붙거나, "ECR-OOO-000"처럼 세부 구분 자리를 O/X로 비워 둔다(와일드카드).
 * 추출 시 extract-standard.readSummaryTable이 만들어 rfp_projects.category_summary(jsonb)에 저장하고, 화면의 구분 탭·검색이 쓴다.
 */

export interface CategorySummaryRow {
  /** 구분명(국문, 원문 그대로 — 괄호 영문 포함 가능) */
  name: string;
  /** 영문 구분명 열이 따로 있으면 */
  nameEn: string | null;
  /** ID 부여규칙 원문(공백 제거·대문자) */
  rule: string;
  count: number | null;
}

export interface RulePattern {
  /** 세그먼트별 코드. null = 와일드카드(OOO·XXX·000) */
  segments: (string | null)[];
}

/** "ECR-OOO-000" → [ECR, null]. 끝의 숫자 세그먼트(일련번호 자리)는 버린다. 규칙이 아니면 null */
export function ruleToPattern(rule: string): RulePattern | null {
  const norm = rule.normalize("NFKC").replace(/\s+/g, "").toUpperCase().replace(/[○◯〇]/g, "O");
  const parts = norm.split("-").filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) parts.pop();
  if (parts.length === 0 || !/^[A-Z]{2,5}$/.test(parts[0])) return null;
  const segments: (string | null)[] = [parts[0]];
  for (const p of parts.slice(1)) {
    if (/^[OX0]{2,5}$/.test(p)) segments.push(null);
    else if (/^[A-Z][A-Z0-9]{1,4}$/.test(p)) segments.push(p);
    else return null;
  }
  return { segments };
}

/** 패턴 문자열("ECR-OOO", "SER") — 경고 문구·맵 키용 */
export function patternKey(p: RulePattern): string {
  return p.segments.map((s) => s ?? "OOO").join("-");
}

/** 구분 코드("ECR-IFR")가 규칙 패턴에 맞는지. exact: 세그먼트 수까지 같아야 함, prefix: 패턴이 코드의 앞부분이면 됨 */
export function matchesRule(p: RulePattern, code: string, mode: "exact" | "prefix" = "exact"): boolean {
  const segs = code.toUpperCase().split("-");
  if (mode === "exact" ? segs.length !== p.segments.length : segs.length < p.segments.length) return false;
  return p.segments.every((s, i) => s === null || s === segs[i]);
}

/** 코드에 맞는 총괄표 행 — 와일드카드 없는 정확 일치 > 와일드카드 일치 > 접두 일치 */
export function findCategorySummary(rows: readonly CategorySummaryRow[], code: string): CategorySummaryRow | null {
  const parsed = rows.map((r) => ({ r, p: ruleToPattern(r.rule) })).filter((x): x is { r: CategorySummaryRow; p: RulePattern } => x.p !== null);
  const exact = parsed.find(({ p }) => !p.segments.includes(null) && matchesRule(p, code));
  if (exact) return exact.r;
  const wild = parsed.find(({ p }) => matchesRule(p, code));
  if (wild) return wild.r;
  const prefix = parsed.find(({ p }) => matchesRule(p, code, "prefix"));
  return prefix?.r ?? null;
}

/** 탭에 붙일 짧은 이름: 괄호(영문·코드) 제거, 끝의 "요구사항" 제거. "클라우드 서비스 요구사항(CSR – MSA)" → "클라우드 서비스" */
export function shortCategoryName(name: string): string {
  const stripped = name
    .replace(/\s*[（(][^（）()]*[）)]/g, " ")
    .replace(/\s*요구\s*사항\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || name.trim();
}

/**
 * 구분 코드의 표시 이름. 총괄표 행이 있으면 그 국문 이름, 없으면 요구사항 행의 구분 셀(fallback) — 둘 다 짧게 만든다.
 * 이름이 코드 자체이거나 비면 null(탭에 코드만).
 */
export function categoryLabel(rows: readonly CategorySummaryRow[], code: string, fallbackName?: string | null): string | null {
  const raw = findCategorySummary(rows, code)?.name ?? fallbackName ?? "";
  const short = shortCategoryName(raw);
  if (!short || short.toUpperCase() === code.toUpperCase()) return null;
  return short;
}

/** jsonb → 행 배열(형식이 어긋난 항목은 버린다) */
export function parseCategorySummary(v: unknown): CategorySummaryRow[] {
  if (!Array.isArray(v)) return [];
  const out: CategorySummaryRow[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.name !== "string" || typeof o.rule !== "string") continue;
    out.push({ name: o.name, nameEn: typeof o.nameEn === "string" ? o.nameEn : null, rule: o.rule, count: typeof o.count === "number" ? o.count : null });
  }
  return out;
}
