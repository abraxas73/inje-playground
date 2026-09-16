/** Claude 사용량 대시보드 공용 타입 — OTel(Claude Code) + 멤버 활동 CSV */

export const DAILY_NUMERIC_FIELDS = [
  "sessions",
  "prompts",
  "prompts_auto",
  "cost_usd",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
  "loc_added",
  "loc_removed",
  "edits_accepted",
  "edits_rejected",
  "commits",
  "pull_requests",
  "active_user_seconds",
  "active_cli_seconds",
] as const;
export type DailyNumericField = (typeof DAILY_NUMERIC_FIELDS)[number];
export type DailyMetrics = Record<DailyNumericField, number>;

export function emptyDailyMetrics(): DailyMetrics {
  return Object.fromEntries(DAILY_NUMERIC_FIELDS.map((f) => [f, 0])) as DailyMetrics;
}

/** claude_code_daily 한 행 (day = KST YYYY-MM-DD) */
export interface DailyRow extends DailyMetrics {
  day: string;
  org_id: string;
  user_email: string;
  account_uuid: string | null;
}

/** claude_code_daily_model 한 행 */
export interface ModelRow {
  day: string;
  org_id: string;
  user_email: string;
  model: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

/** claude_code.api_request 이벤트 1건 */
export interface ApiRequestEvent {
  ts: string; // ISO
  org_id: string;
  user_email: string;
  account_uuid: string | null;
  session_id: string | null;
  model: string | null;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  duration_ms: number | null;
  query_source: string | null;
  request_id: string | null;
}

/** team = 우리 Team 조직(CSV 업로드로 생성) · personal = OTel이 자동 등록한 개인 Claude 계정 조직 · system = unknown·test-org */
export type OrgCategory = "team" | "personal" | "system";

export interface ClaudeOrg {
  id: string;
  name: string;
  seats_total: number | null;
  sort_order: number;
  /** 2026-09-16 SQL 이전 응답에는 없을 수 있다 — org-options.ts의 orgCategory()로 보정 */
  category?: OrgCategory;
}

/** claude_code_env_daily 한 행 — 실행 환경(리소스 os.type·host.arch·service.version, 포인트 terminal.type)별 데이터 포인트 수 */
export interface EnvDailyRow {
  day: string;
  org_id: string;
  user_email: string;
  os_type: string;
  host_arch: string;
  app_version: string;
  terminal_type: string;
  points: number;
}
export type UserEnv = Pick<EnvDailyRow, "os_type" | "host_arch" | "app_version" | "terminal_type" | "points">;

/** members-analytics CSV 한 행 */
export interface MemberActivityRow {
  name: string;
  email: string;
  role: string;
  seat_tier: string;
  last_active: string | null;
  days_active: number;
  chats: number;
  messages: number;
  projects_created: number;
  projects_used: number;
  pull_requests: number;
  code_sessions: number;
  file_edits: number;
  cowork_sessions: number;
  cowork_messages: number;
  artifacts_created: number;
  claude_code_artifacts: number;
  cowork_artifacts: number;
  estimated_spend_usd: number;
}

export interface CsvImport {
  id: string;
  org_id: string;
  period_start: string;
  period_end: string;
  filename: string | null;
  row_count: number;
  created_at: string;
}

export interface UserUsageRow extends DailyMetrics {
  user_email: string;
  orgs: string[];
  active_days: number;
  name: string | null;
  seat_tier: string | null;
  /** 사내 조직도(company_directory) 조인 — 센터/팀명, 본부, 부문. 명부에 없으면 null */
  employee_name: string | null;
  team: string | null;
  headquarters: string | null;
  division: string | null;
  /** 기간 내 실행 환경, 데이터 포인트 많은 순 상위 5개(2026-09-16 이후 수집분만) */
  env: UserEnv[];
}

export interface UsageSummary {
  range: { from: string; to: string };
  orgs: ClaudeOrg[];
  totals: DailyMetrics & { active_users: number };
  users: UserUsageRow[];
  daily: { day: string; cost_usd: number; sessions: number; active_users: number }[];
  models: {
    model: string;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  }[];
}
