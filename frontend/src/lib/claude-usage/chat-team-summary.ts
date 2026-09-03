/**
 * 채팅·Cowork(CSV) 멤버 활동을 사내 조직도 팀 단위로 합친다 — /admin/claude-chat 팀별 집계 탭.
 * - 팀 = 조직도 말단 부서(team). 명부에 없는 이메일은 "명부 없음".
 * - 상위 조직 표기는 조직도 경로에서 팀 바로 위 단위(parent_unit, 예: 디자인센터). 없으면 본부→부문.
 * - 같은 사람이 여러 Claude 조직에 있으면(소유자 계정 등) 행이 조직마다 오므로 활동 수치는 더하고 인원은 이메일 기준 1명으로 센다.
 */

export interface ChatMemberLike {
  email: string;
  days_active: number;
  chats: number;
  messages: number;
  code_sessions: number;
  cowork_sessions: number;
  cowork_messages: number;
  projects_used: number;
  artifacts_created: number;
  estimated_spend_usd: number;
  team?: string | null;
  parent_unit?: string | null;
  headquarters?: string | null;
  division?: string | null;
}

export interface ChatTeamRow {
  team: string;
  parent: string | null;
  /** 시트 보유자(고유 이메일) */
  users: number;
  /** 기간 내 활동일이 있는 고유 이메일 */
  active_users: number;
  chats: number;
  messages: number;
  code_sessions: number;
  cowork_sessions: number;
  cowork_messages: number;
  projects_used: number;
  artifacts_created: number;
  spend_usd: number;
}

export const NO_DIRECTORY_TEAM = "명부 없음";

export function parentUnitOf(u: ChatMemberLike): string | null {
  if (!u.team) return null;
  if (u.parent_unit && u.parent_unit !== u.team) return u.parent_unit;
  if (u.headquarters && u.headquarters !== u.team) return u.headquarters;
  if (u.division && u.division !== u.team) return u.division;
  return null;
}

export function aggregateChatTeams(rows: ChatMemberLike[]): ChatTeamRow[] {
  const map = new Map<string, ChatTeamRow & { _emails: Set<string>; _active: Set<string> }>();
  for (const u of rows) {
    const team = u.team ?? NO_DIRECTORY_TEAM;
    let t = map.get(team);
    if (!t) {
      t = { team, parent: parentUnitOf(u), users: 0, active_users: 0, chats: 0, messages: 0, code_sessions: 0, cowork_sessions: 0, cowork_messages: 0, projects_used: 0, artifacts_created: 0, spend_usd: 0, _emails: new Set(), _active: new Set() };
      map.set(team, t);
    }
    const email = u.email.toLowerCase();
    t._emails.add(email);
    if (u.days_active > 0) t._active.add(email);
    t.chats += u.chats;
    t.messages += u.messages;
    t.code_sessions += u.code_sessions;
    t.cowork_sessions += u.cowork_sessions;
    t.cowork_messages += u.cowork_messages;
    t.projects_used += u.projects_used;
    t.artifacts_created += u.artifacts_created;
    t.spend_usd += u.estimated_spend_usd;
  }
  return [...map.values()].map(({ _emails, _active, ...t }) => ({ ...t, users: _emails.size, active_users: _active.size }));
}
