export interface TeamConfig {
  participants: string[];
  teamCount: number;
  minPerTeam: number;
  maxPerTeam: number;
  cardHolders: string[];
}

export interface TeamMember {
  name: string;
  hasCard: boolean;
}

export interface Team {
  name: string;
  members: TeamMember[];
}

export interface TeamResult {
  teams: Team[];
}
