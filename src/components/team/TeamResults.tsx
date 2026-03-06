"use client";

import type { Team } from "@/types/team";

const TEAM_COLORS = [
  "bg-blue-50 border-blue-200",
  "bg-emerald-50 border-emerald-200",
  "bg-amber-50 border-amber-200",
  "bg-purple-50 border-purple-200",
  "bg-rose-50 border-rose-200",
  "bg-cyan-50 border-cyan-200",
  "bg-orange-50 border-orange-200",
  "bg-indigo-50 border-indigo-200",
  "bg-teal-50 border-teal-200",
  "bg-pink-50 border-pink-200",
];

const TEAM_LABEL_COLORS = [
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
        <div
          key={team.name}
          className={`rounded-xl border p-4 ${TEAM_COLORS[index % TEAM_COLORS.length]}`}
        >
          <div className="flex items-center gap-2 mb-3">
            <span
              className={`text-white text-xs font-bold px-2 py-1 rounded ${TEAM_LABEL_COLORS[index % TEAM_LABEL_COLORS.length]}`}
            >
              {team.name}
            </span>
            <span className="text-xs text-slate-500">
              {team.members.length}명
            </span>
          </div>
          <ul className="space-y-1">
            {team.members.map((member, mIndex) => (
              <li
                key={`${member.name}-${mIndex}`}
                className="text-sm text-slate-700 flex items-center gap-1.5"
              >
                {member.name}
                {member.hasCard && (
                  <span className="text-xs font-medium text-amber-700 bg-amber-200 px-1.5 py-0.5 rounded-full">
                    법카
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
