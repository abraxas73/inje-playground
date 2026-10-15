/**
 * Claude에 보내기 직전에 민감정보를 가린다(설계서 §2-4). 순서: 주민 → 카드 → 전화 → 계좌(겹치는 형식을 앞에서 먼저 잡는다).
 * ponytail: 정규식 휴리스틱 — 하이픈 없는 계좌·외국 형식은 놓친다. 오탐·미탐 사례가 나오면 여기 규칙을 고친다.
 */
const EDGE_L = "(?<![\\d-])", EDGE_R = "(?![\\d-])";
const RRN = new RegExp(`${EDGE_L}(\\d{2})(\\d{2})(\\d{2})-?[1-4]\\d{6}${EDGE_R}`, "g");
const CARD = new RegExp(`${EDGE_L}\\d(?:[ -]?\\d){12,18}${EDGE_R}`, "g");
const PHONE = new RegExp(`${EDGE_L}01[016789]-?\\d{3,4}-?\\d{4}${EDGE_R}`, "g");
const ACCOUNT = new RegExp(`${EDGE_L}\\d{2,6}-\\d{2,6}-\\d{2,7}(?:-\\d{1,3})?${EDGE_R}`, "g");
const LANDLINE = /^0\d{1,2}-\d{3,4}-\d{4}$/;
const BIZ_NO = /^\d{3}-\d{2}-\d{5}$/;

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i];
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

export function maskText(text: string, opts: { keepPhone?: boolean } = {}): { text: string; count: number } {
  let count = 0;
  const sub = (re: RegExp, label: string, ok: (m: string, g: string[]) => boolean) => (s: string) =>
    s.replace(re, (m, ...g) => (ok(m, g as string[]) ? (count++, label) : m));
  let out = sub(RRN, "[주민번호]", (_m, [, mm, dd]) => +mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31)(text);
  out = sub(CARD, "[카드번호]", (m) => { const d = m.replace(/\D/g, ""); return d.length >= 13 && d.length <= 19 && luhn(d); })(out);
  if (!opts.keepPhone) out = sub(PHONE, "[전화번호]", () => true)(out);
  out = sub(ACCOUNT, "[계좌번호]", (m) => {
    const n = m.replace(/\D/g, "").length;
    return n >= 10 && n <= 14 && !LANDLINE.test(m) && !BIZ_NO.test(m) && !/^01[016789]-\d{3,4}-\d{4}$/.test(m);
  })(out);
  return { text: out, count };
}
