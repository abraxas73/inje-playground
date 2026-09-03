/**
 * claude.ai 멤버 활동 CSV(30일 롤링)의 "데이터 기간" 옵션.
 * 조직별로 CSV를 따로 내보내므로 같은 회차라도 시작·종료일이 하루쯤 어긋날 수 있어 종료일(as-of) 기준으로 묶는다.
 * 화면은 이 옵션으로 기간을 고르고, API는 periodEnd로 조직별 최신 업로드를 선택한다.
 */
export interface CsvPeriodOption {
  /** 그룹 키 = period_end */
  end: string;
  /** 그룹 안에서 가장 이른 period_start */
  start: string;
  /** 이 기간의 CSV가 있는 Claude 조직 수 */
  orgs: number;
}

export function buildPeriodOptions(imports: { org_id: string; period_start: string; period_end: string }[]): CsvPeriodOption[] {
  const byEnd = new Map<string, { start: string; orgs: Set<string> }>();
  for (const i of imports) {
    const g = byEnd.get(i.period_end);
    if (!g) byEnd.set(i.period_end, { start: i.period_start, orgs: new Set([i.org_id]) });
    else { if (i.period_start < g.start) g.start = i.period_start; g.orgs.add(i.org_id); }
  }
  return [...byEnd.entries()]
    .map(([end, g]) => ({ end, start: g.start, orgs: g.orgs.size }))
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
}

export const periodLabel = (o: { start: string; end: string }): string => `${o.start} ~ ${o.end}`;
