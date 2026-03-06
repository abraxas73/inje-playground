"use client";

interface TeamConfigProps {
  teamCount: number;
  minPerTeam: number;
  maxPerTeam: number;
  onTeamCountChange: (v: number) => void;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
}

export default function TeamConfig({
  teamCount,
  minPerTeam,
  maxPerTeam,
  onTeamCountChange,
  onMinChange,
  onMaxChange,
}: TeamConfigProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          팀 수
        </label>
        <input
          type="number"
          min={1}
          max={20}
          value={teamCount}
          onChange={(e) => onTeamCountChange(Number(e.target.value))}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          팀별 최소 인원
        </label>
        <input
          type="number"
          min={1}
          max={50}
          value={minPerTeam}
          onChange={(e) => onMinChange(Number(e.target.value))}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          팀별 최대 인원
        </label>
        <input
          type="number"
          min={1}
          max={50}
          value={maxPerTeam}
          onChange={(e) => onMaxChange(Number(e.target.value))}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}
