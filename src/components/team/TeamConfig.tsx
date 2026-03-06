"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      <div className="space-y-2">
        <Label htmlFor="teamCount">팀 수</Label>
        <Input
          id="teamCount"
          type="number"
          min={1}
          max={20}
          value={teamCount}
          onChange={(e) => onTeamCountChange(Number(e.target.value))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="minPerTeam">팀별 최소 인원</Label>
        <Input
          id="minPerTeam"
          type="number"
          min={1}
          max={50}
          value={minPerTeam}
          onChange={(e) => onMinChange(Number(e.target.value))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="maxPerTeam">팀별 최대 인원</Label>
        <Input
          id="maxPerTeam"
          type="number"
          min={1}
          max={50}
          value={maxPerTeam}
          onChange={(e) => onMaxChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
