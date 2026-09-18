/** 일별 행 → 대시보드 요약. 순수 함수. */
import { DAILY_NUMERIC_FIELDS, emptyDailyMetrics, type ClaudeOrg, type DailyRow, type MemberActivityRow, type ModelRow, type UsageSummary, type UserUsageRow, type EnvDailyRow, type UserEnv } from "@/types/claude-usage";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDate(d: Date): { y: number; m: number; d: number } {
  const t = new Date(d.getTime() + KST_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function addDays(day: string, n: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export type RangePreset = "7d" | "30d" | "90d" | "thisMonth" | "lastMonth";

export function dateRangePreset(preset: RangePreset, today: Date = new Date()): { from: string; to: string } {
  const { y, m, d } = kstDate(today);
  const to = ymd(y, m, d);
  switch (preset) {
    case "7d":
      return { from: addDays(to, -6), to };
    case "30d":
      return { from: addDays(to, -29), to };
    case "90d":
      return { from: addDays(to, -89), to };
    case "thisMonth":
      return { from: ymd(y, m, 1), to };
    case "lastMonth": {
      const first = new Date(Date.UTC(y, m - 1, 1));
      first.setUTCMonth(first.getUTCMonth() - 1);
      const from = first.toISOString().slice(0, 10);
      return { from, to: addDays(ymd(y, m, 1), -1) };
    }
  }
}

export function acceptRate(accepted: number, rejected: number): number | null {
  const total = accepted + rejected;
  if (total <= 0) return null;
  return Math.round((accepted / total) * 100);
}

const NO_SEAT_TIERS = new Set(["", "unassigned", "none", "할당되지 않음"]);

/** 시트가 실제로 배정됐는지(빈 값/"Unassigned"/"None"/"할당되지 않음"은 시트 없음) */
export function hasSeat(tier: string | null | undefined): boolean {
  return !NO_SEAT_TIERS.has((tier ?? "").trim().toLowerCase());
}

export function isIdleSeat(m: MemberActivityRow): boolean {
  if (!hasSeat(m.seat_tier)) return false;
  return m.chats + m.code_sessions + m.cowork_sessions === 0;
}

export function isActive(r: DailyRow): boolean {
  return r.sessions > 0 || r.prompts > 0 || r.cost_usd > 0;
}

/** 사용자별 실행 환경 — 같은 (os, arch, version, terminal)을 합치고 포인트 많은 순 상위 5개 */
export function summarizeEnv(rows: EnvDailyRow[], top = 5): Map<string, UserEnv[]> {
  const byUser = new Map<string, Map<string, UserEnv>>();
  for (const r of rows) {
    const key = `${r.os_type}|${r.host_arch}|${r.app_version}|${r.terminal_type}`;
    let m = byUser.get(r.user_email);
    if (!m) { m = new Map(); byUser.set(r.user_email, m); }
    const e = m.get(key) ?? { os_type: r.os_type, host_arch: r.host_arch, app_version: r.app_version, terminal_type: r.terminal_type, points: 0 };
    e.points += Number(r.points) || 0;
    m.set(key, e);
  }
  const out = new Map<string, UserEnv[]>();
  for (const [email, m] of byUser) out.set(email, [...m.values()].sort((a, b) => b.points - a.points || a.app_version.localeCompare(b.app_version)).slice(0, top));
  return out;
}

export function summarize(input: {
  rows: DailyRow[];
  models: ModelRow[];
  orgs: ClaudeOrg[];
  members: Pick<MemberActivityRow, "email" | "name" | "seat_tier">[];
  /** 사내 조직도 명부(선택) — 이메일로 소속(team/division) 조인 */
  directory?: { email: string; name?: string | null; team: string | null; headquarters: string | null; division: string | null }[];
  /** 실행 환경 일 집계(선택, claude_code_env_daily) — 사용자별 포인트 많은 순 상위 5개를 env로 붙인다 */
  env?: EnvDailyRow[];
  from: string;
  to: string;
}): UsageSummary {
  const envByUser = summarizeEnv(input.env ?? []);
  const memberByEmail = new Map(input.members.map((m) => [m.email.toLowerCase(), m]));
  const dirByEmail = new Map((input.directory ?? []).map((d) => [d.email.toLowerCase(), d]));

  const users = new Map<string, UserUsageRow & { _days: Set<string>; _orgs: Set<string> }>();
  const totals = { ...emptyDailyMetrics(), active_users: 0 };
  const dailyMap = new Map<string, { cost_usd: number; sessions: number; users: Set<string> }>();
  const activeEmails = new Set<string>();

  for (const r of input.rows) {
    let u = users.get(r.user_email);
    if (!u) {
      const m = memberByEmail.get(r.user_email.toLowerCase());
      const d = dirByEmail.get(r.user_email.toLowerCase());
      u = { ...emptyDailyMetrics(), user_email: r.user_email, orgs: [], active_days: 0, name: m?.name?.trim() || null, seat_tier: m?.seat_tier ?? null, employee_name: d?.name ?? null, team: d?.team ?? null, headquarters: d?.headquarters ?? null, division: d?.division ?? null, env: envByUser.get(r.user_email) ?? [], _days: new Set(), _orgs: new Set() };
      users.set(r.user_email, u);
    }
    u._orgs.add(r.org_id);
    for (const f of DAILY_NUMERIC_FIELDS) {
      u[f] += r[f];
      totals[f] += r[f];
    }
    const d = dailyMap.get(r.day) ?? { cost_usd: 0, sessions: 0, users: new Set<string>() };
    d.cost_usd += r.cost_usd;
    d.sessions += r.sessions;
    if (isActive(r)) {
      u._days.add(r.day);
      d.users.add(r.user_email);
      activeEmails.add(r.user_email);
    }
    dailyMap.set(r.day, d);
  }
  totals.active_users = activeEmails.size;

  const userRows: UserUsageRow[] = [...users.values()]
    .map(({ _days, _orgs, ...u }) => ({ ...u, orgs: [..._orgs].sort(), active_days: _days.size }))
    .sort((a, b) => b.cost_usd - a.cost_usd || b.sessions - a.sessions || a.user_email.localeCompare(b.user_email));

  const daily: UsageSummary["daily"] = [];
  for (let day = input.from; day <= input.to; day = addDays(day, 1)) {
    const d = dailyMap.get(day);
    daily.push({ day, cost_usd: d?.cost_usd ?? 0, sessions: d?.sessions ?? 0, active_users: d?.users.size ?? 0 });
  }

  const modelMap = new Map<string, UsageSummary["models"][number]>();
  for (const m of input.models) {
    const e = modelMap.get(m.model) ?? { model: m.model, cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
    e.cost_usd += m.cost_usd;
    e.input_tokens += m.input_tokens;
    e.output_tokens += m.output_tokens;
    e.cache_read_tokens += m.cache_read_tokens;
    e.cache_creation_tokens += m.cache_creation_tokens;
    modelMap.set(m.model, e);
  }
  const models = [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd);

  return { range: { from: input.from, to: input.to }, orgs: input.orgs, totals, users: userRows, daily, models };
}
