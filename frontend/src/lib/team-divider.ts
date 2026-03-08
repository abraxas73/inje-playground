import type { TeamConfig, TeamResult } from "@/types/team";

export function validateTeamConfig(config: TeamConfig): string | null {
  const { participants, teamCount, minPerTeam, maxPerTeam } = config;
  const total = participants.length;

  if (total === 0) return "참여자를 추가해주세요.";
  if (teamCount <= 0) return "팀 수는 1 이상이어야 합니다.";
  if (minPerTeam <= 0) return "최소 인원은 1 이상이어야 합니다.";
  if (maxPerTeam < minPerTeam)
    return "최대 인원은 최소 인원 이상이어야 합니다.";
  if (teamCount * minPerTeam > total)
    return `인원이 부족합니다. 최소 ${teamCount * minPerTeam}명이 필요합니다.`;
  if (teamCount * maxPerTeam < total)
    return `팀 수가 부족하거나 최대 인원을 늘려주세요. 현재 최대 수용: ${teamCount * maxPerTeam}명`;

  return null;
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function divideTeams(config: TeamConfig): TeamResult {
  const { participants, teamCount, minPerTeam, maxPerTeam, cardHolders } = config;
  const cardHolderSet = new Set(cardHolders);

  // Separate card holders and regular members
  const cardMembers = shuffle(participants.filter((p) => cardHolderSet.has(p)));
  const regularMembers = shuffle(participants.filter((p) => !cardHolderSet.has(p)));

  // Initialize teams
  const teams: { name: string; hasCard: boolean }[][] = Array.from(
    { length: teamCount },
    () => []
  );

  // 1. Distribute card holders round-robin first
  let teamIndex = 0;
  for (const member of cardMembers) {
    teams[teamIndex].push({ name: member, hasCard: true });
    teamIndex = (teamIndex + 1) % teamCount;
  }

  // 2. Distribute regular members
  // First, fill minimum per team
  let cursor = 0;
  for (let t = 0; t < teamCount; t++) {
    while (teams[t].length < minPerTeam && cursor < regularMembers.length) {
      teams[t].push({ name: regularMembers[cursor++], hasCard: false });
    }
  }

  // Then distribute remaining round-robin
  while (cursor < regularMembers.length) {
    for (let t = 0; t < teamCount && cursor < regularMembers.length; t++) {
      if (teams[t].length < maxPerTeam) {
        teams[t].push({ name: regularMembers[cursor++], hasCard: false });
      }
    }
  }

  return {
    teams: teams.map((members, i) => ({
      name: `팀 ${i + 1}`,
      members,
    })),
  };
}
