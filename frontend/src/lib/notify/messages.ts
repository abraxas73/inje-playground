/**
 * 사람이 읽는 알림 본문 조립. provider(Dooray/Teams)와 무관한 순수 함수.
 * 출력 포맷은 기존 라우트(team-notify, food/decide)와 동일해야 한다.
 */

export interface TeamResultInput {
  name: string;
  members: { name: string; hasCard: boolean }[];
}

export function buildTeamResultMessage(teams: TeamResultInput[]): string {
  const teamLines = teams.map((team) => {
    const memberNames = team.members
      .map((m) => (m.hasCard ? `${m.name}(법카)` : m.name))
      .join(", ");
    return `**${team.name}** (${team.members.length}명): ${memberNames}`;
  });
  return [`👥 팀 구성 결과`, ``, ...teamLines].join("\n");
}

export interface FoodDecisionInput {
  place_name: string;
  address?: string | null;
  category_name?: string | null;
  place_url?: string | null;
  members: string[];
}

export function buildFoodDecisionMessage(d: FoodDecisionInput): string {
  return [
    `🍽️ 밥 먹으러 갑시다!`,
    ``,
    `📍 **${d.place_name}**`,
    d.address ? `📫 ${d.address}` : null,
    d.category_name ? `🏷️ ${d.category_name}` : null,
    `👥 ${d.members.join(", ")}`,
    d.place_url ? `🔗 ${d.place_url}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
