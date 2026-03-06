"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Team } from "@/types/team";

const TEAM_COLORS = [
  "border-blue-200 bg-blue-50/50",
  "border-emerald-200 bg-emerald-50/50",
  "border-amber-200 bg-amber-50/50",
  "border-purple-200 bg-purple-50/50",
  "border-rose-200 bg-rose-50/50",
  "border-cyan-200 bg-cyan-50/50",
  "border-orange-200 bg-orange-50/50",
  "border-indigo-200 bg-indigo-50/50",
  "border-teal-200 bg-teal-50/50",
  "border-pink-200 bg-pink-50/50",
];

const TEAM_BADGE_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-purple-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-orange-600",
  "bg-indigo-600",
  "bg-teal-600",
  "bg-pink-600",
];

interface TeamResultsProps {
  teams: Team[];
}

export default function TeamResults({ teams }: TeamResultsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {teams.map((team, index) => (
        <Card
          key={team.name}
          className={`${TEAM_COLORS[index % TEAM_COLORS.length]}`}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CardTitle>
                <span
                  className={`text-white text-xs font-bold px-2.5 py-1 rounded-md ${TEAM_BADGE_COLORS[index % TEAM_BADGE_COLORS.length]}`}
                >
                  {team.name}
                </span>
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {team.members.length}명
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {team.members.map((member, mIndex) => (
                <li
                  key={`${member.name}-${mIndex}`}
                  className="text-sm flex items-center gap-1.5"
                >
                  {member.name}
                  {member.hasCard && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-300 bg-amber-100 text-amber-800">
                      법카
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
