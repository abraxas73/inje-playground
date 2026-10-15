export type UsageRow = { user_id: string; day: string; turns: number; input_tokens: number; output_tokens: number; model_turns: Record<string, number>; masked: number };
export type UserUsage = { userId: string; name: string; email: string; team: string; turns: number; inputTokens: number; outputTokens: number; opusTurns: number; masked: number };
export type TeamUsage = { team: string; users: number; turns: number; inputTokens: number; outputTokens: number };

/** assistant_usage 행 → 사용자·팀 합계(턴 많은 순). 본문은 다루지 않는다. */
export function aggregateUsage(rows: UsageRow[], people: Map<string, { name: string; email: string }>, teams: Map<string, string>): { users: UserUsage[]; teams: TeamUsage[] } {
  const byUser = new Map<string, UserUsage>();
  for (const r of rows) {
    const p = people.get(r.user_id) ?? { name: "", email: "" };
    const u = byUser.get(r.user_id) ?? { userId: r.user_id, name: p.name || p.email || r.user_id.slice(0, 8), email: p.email, team: teams.get(p.email) || "미지정", turns: 0, inputTokens: 0, outputTokens: 0, opusTurns: 0, masked: 0 };
    u.turns += Number(r.turns); u.inputTokens += Number(r.input_tokens); u.outputTokens += Number(r.output_tokens); u.masked += Number(r.masked);
    u.opusTurns += Object.entries(r.model_turns ?? {}).filter(([k]) => k.includes("opus")).reduce((s, [, v]) => s + Number(v), 0);
    byUser.set(r.user_id, u);
  }
  const users = [...byUser.values()].sort((a, b) => b.turns - a.turns);
  const byTeam = new Map<string, TeamUsage>();
  for (const u of users) {
    const t = byTeam.get(u.team) ?? { team: u.team, users: 0, turns: 0, inputTokens: 0, outputTokens: 0 };
    t.users++; t.turns += u.turns; t.inputTokens += u.inputTokens; t.outputTokens += u.outputTokens;
    byTeam.set(u.team, t);
  }
  return { users, teams: [...byTeam.values()].sort((a, b) => b.turns - a.turns) };
}
