/**
 * 브랜드 검사(ppt-service check.py) 결과를 항목별로 묶는다. 메시지 문구는 패키지 check.py가 낸다 — 분류 규칙은 그 문구에 맞춘다.
 * 통과한 항목도 보여 주려는 것이라 항목 목록은 고정이다.
 */
export interface BrandCheckItem { key: string; label: string; desc: string; issues: string[] }

const ITEMS: ReadonlyArray<{ key: string; label: string; desc: string; match: RegExp }> = [
  { key: "color", label: "색상", desc: "템플릿 팔레트 색만 사용, 제품 지정색은 제품 장표에만", match: /팔레트 밖 색|제품 지정색/ },
  { key: "font", label: "글꼴", desc: "모든 글자가 Pretendard", match: /Pretendard 아닌 폰트|테마 폰트/ },
  { key: "bold", label: "굵게", desc: "굵게 속성 대신 폰트 이름(Pretendard Bold)으로", match: /굵게/ },
  { key: "size", label: "글자 크기", desc: "허용된 크기만", match: /글자 크기/ },
  { key: "spacing", label: "줄간격", desc: "템플릿 줄간격 값만(본문 130%)", match: /줄간격/ },
  { key: "leftover", label: "잔여 문구", desc: "템플릿 자리표시 글이 채워지지 않고 남지 않음", match: /잔여 문구/ },
];

/** issues: 검사기의 {장표: [메시지…]} → 항목별 목록(통과 항목은 issues 빈 배열). 어느 항목에도 안 맞는 메시지는 '기타'로. */
export function brandCheckItems(issues: Record<string, string[]>): BrandCheckItem[] {
  const out: BrandCheckItem[] = ITEMS.map((i) => ({ key: i.key, label: i.label, desc: i.desc, issues: [] }));
  const other: string[] = [];
  for (const [slide, msgs] of Object.entries(issues)) {
    for (const m of msgs) {
      const idx = ITEMS.findIndex((i) => i.match.test(m));
      (idx >= 0 ? out[idx].issues : other).push(`${slide}: ${m}`);
    }
  }
  if (other.length) out.push({ key: "other", label: "기타", desc: "분류되지 않은 지적", issues: other });
  return out;
}
