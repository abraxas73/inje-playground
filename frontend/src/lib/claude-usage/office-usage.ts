/**
 * Claude for M365(Excel·Word·PowerPoint·Outlook) 추가 기능 사용량 — RPC claude_office_usage가 돌려주는
 * 일·사용자·표면 행을 화면용(사용자별·표면별·일별·총계)으로 합친다. 순수 함수.
 * 원천은 조직 설정의 커스텀 OTel 수집기로 받은 스팬(claude_office_trace_log)이며, 수집기를 등록한 Claude 조직만 잡힌다.
 */
import { addDays } from "./aggregate";

export const OFFICE_SURFACE_LABELS: Record<string, string> = { sheet: "Excel", doc: "Word", slide: "PowerPoint", mail: "Outlook" };
export const OFFICE_SURFACE_ORDER = ["sheet", "doc", "slide", "mail"];

export function surfaceLabel(s: string | null | undefined): string {
  if (!s) return "기타";
  return OFFICE_SURFACE_LABELS[s] ?? s;
}

export const OFFICE_SUM_FIELDS = [
  "turns",
  "sessions",
  "model_calls",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
  "tool_calls",
  "tool_errors",
  "file_uploads",
] as const;
export type OfficeSumField = (typeof OFFICE_SUM_FIELDS)[number];
export type OfficeMetrics = Record<OfficeSumField, number>;

export function emptyOfficeMetrics(): OfficeMetrics {
  return Object.fromEntries(OFFICE_SUM_FIELDS.map((f) => [f, 0])) as OfficeMetrics;
}

/** RPC 한 행 (day = KST 날짜). numeric은 문자열로 오므로 numifyOfficeRow로 변환한다 */
export interface OfficeDailyRow extends OfficeMetrics {
  day: string;
  org_id: string | null;
  user_email: string;
  surface: string;
}

export function numifyOfficeRow(raw: Record<string, unknown>): OfficeDailyRow {
  const row = { day: String(raw.day), org_id: raw.org_id == null ? null : String(raw.org_id), user_email: String(raw.user_email).toLowerCase(), surface: String(raw.surface ?? "unknown"), ...emptyOfficeMetrics() };
  for (const f of OFFICE_SUM_FIELDS) row[f] = Number(raw[f]) || 0;
  return row;
}

export interface OfficeUserRow extends OfficeMetrics {
  user_email: string;
  orgs: string[];
  active_days: number;
  /** 표면별 턴 수 (sheet/doc/slide/mail) */
  surfaces: Record<string, number>;
}

export interface OfficeSummary {
  totals: OfficeMetrics & { active_users: number; active_days: number };
  users: OfficeUserRow[];
  surfaces: { surface: string; label: string; turns: number; users: number; output_tokens: number }[];
  daily: { day: string; turns: number; users: number; output_tokens: number }[];
}

/**
 * 세션 수는 일 단위 고유 세션의 합이라 날을 넘긴 세션은 두 번 셀 수 있다(근사치).
 */
export function summarizeOffice(rows: OfficeDailyRow[], from: string, to: string): OfficeSummary {
  const users = new Map<string, OfficeUserRow & { _days: Set<string>; _orgs: Set<string> }>();
  const totals = { ...emptyOfficeMetrics(), active_users: 0, active_days: 0 };
  const dailyMap = new Map<string, { turns: number; output_tokens: number; users: Set<string> }>();
  const surfaceMap = new Map<string, { turns: number; output_tokens: number; users: Set<string> }>();
  const activeDays = new Set<string>();

  for (const r of rows) {
    let u = users.get(r.user_email);
    if (!u) {
      u = { ...emptyOfficeMetrics(), user_email: r.user_email, orgs: [], active_days: 0, surfaces: {}, _days: new Set(), _orgs: new Set() };
      users.set(r.user_email, u);
    }
    for (const f of OFFICE_SUM_FIELDS) {
      u[f] += r[f];
      totals[f] += r[f];
    }
    if (r.org_id) u._orgs.add(r.org_id);
    u.surfaces[r.surface] = (u.surfaces[r.surface] ?? 0) + r.turns;
    if (r.turns > 0) {
      u._days.add(r.day);
      activeDays.add(`${r.user_email}|${r.day}`);
    }
    const d = dailyMap.get(r.day) ?? { turns: 0, output_tokens: 0, users: new Set<string>() };
    d.turns += r.turns;
    d.output_tokens += r.output_tokens;
    if (r.turns > 0) d.users.add(r.user_email);
    dailyMap.set(r.day, d);
    const s = surfaceMap.get(r.surface) ?? { turns: 0, output_tokens: 0, users: new Set<string>() };
    s.turns += r.turns;
    s.output_tokens += r.output_tokens;
    if (r.turns > 0) s.users.add(r.user_email);
    surfaceMap.set(r.surface, s);
  }
  totals.active_users = [...users.values()].filter((u) => u.turns > 0).length;
  totals.active_days = activeDays.size;

  const userRows: OfficeUserRow[] = [...users.values()]
    .map(({ _days, _orgs, ...u }) => ({ ...u, orgs: [..._orgs].sort(), active_days: _days.size }))
    .sort((a, b) => b.turns - a.turns || b.output_tokens - a.output_tokens || a.user_email.localeCompare(b.user_email));

  const daily: OfficeSummary["daily"] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const d = dailyMap.get(day);
    daily.push({ day, turns: d?.turns ?? 0, users: d?.users.size ?? 0, output_tokens: d?.output_tokens ?? 0 });
  }

  const surfaces = [...surfaceMap.entries()]
    .map(([surface, s]) => ({ surface, label: surfaceLabel(surface), turns: s.turns, users: s.users.size, output_tokens: s.output_tokens }))
    .sort((a, b) => {
      const ia = OFFICE_SURFACE_ORDER.indexOf(a.surface), ib = OFFICE_SURFACE_ORDER.indexOf(b.surface);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  return { totals, users: userRows, surfaces, daily };
}

/** "Excel 3 · Word 1" 형태의 표면 분포 문자열 */
export function surfacesText(surfaces: Record<string, number>): string {
  const keys = Object.keys(surfaces).sort((a, b) => {
    const ia = OFFICE_SURFACE_ORDER.indexOf(a), ib = OFFICE_SURFACE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return keys.filter((k) => surfaces[k] > 0).map((k) => `${surfaceLabel(k)} ${surfaces[k].toLocaleString("ko-KR")}`).join(" · ") || "—";
}
