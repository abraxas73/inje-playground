/**
 * Claude Code(OTel) 사용자 행을 사내 조직도 팀 단위로 합친다 — 어드민 팀별 집계 탭과 개인(조직장) 화면 공용.
 * - 팀 = 조직도 말단 부서(team). 명부에 없는 이메일은 "명부 없음".
 * - 상위 조직 표기는 팀 바로 위 단위(parent_unit) → 본부 → 부문 (chat-team-summary와 같은 규칙).
 * - 인원은 고유 이메일(소문자)로 센다. 활동자 = 기간 내 세션 또는 비용이 있는 인원.
 */
import { NO_DIRECTORY_TEAM, parentUnitOf, type OrgUnitLike } from "./chat-team-summary";

export const CODE_TEAM_SUM_FIELDS = [
  "cost_usd",
  "sessions",
  "prompts",
  "prompts_auto",
  "input_tokens",
  "output_tokens",
  "loc_added",
  "loc_removed",
  "edits_accepted",
  "edits_rejected",
  "commits",
  "pull_requests",
  "active_user_seconds",
] as const;
export type CodeTeamSumField = (typeof CODE_TEAM_SUM_FIELDS)[number];

export type CodeMemberLike = OrgUnitLike & { email: string } & Record<CodeTeamSumField, number>;

export type CodeTeamRow = Record<CodeTeamSumField, number> & {
  team: string;
  parent: string | null;
  /** 고유 이메일 수 */
  users: number;
  /** 기간 내 세션 또는 비용이 있는 고유 이메일 수 */
  active_users: number;
};

export function aggregateCodeTeams(rows: CodeMemberLike[]): CodeTeamRow[] {
  const map = new Map<string, CodeTeamRow & { _emails: Set<string>; _active: Set<string> }>();
  for (const u of rows) {
    const team = u.team ?? NO_DIRECTORY_TEAM;
    let t = map.get(team);
    if (!t) {
      const sums = Object.fromEntries(CODE_TEAM_SUM_FIELDS.map((f) => [f, 0])) as Record<CodeTeamSumField, number>;
      t = { ...sums, team, parent: parentUnitOf(u), users: 0, active_users: 0, _emails: new Set<string>(), _active: new Set<string>() };
      map.set(team, t);
    }
    const email = u.email.toLowerCase();
    t._emails.add(email);
    if (u.sessions > 0 || u.cost_usd > 0) t._active.add(email);
    for (const f of CODE_TEAM_SUM_FIELDS) t[f] += Number(u[f]) || 0;
  }
  return [...map.values()].map(({ _emails, _active, ...t }) => ({ ...t, users: _emails.size, active_users: _active.size }));
}
