"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TeamConfigProps {
  teamCount: number;
  minPerTeam: number;
  maxPerTeam: number;
  distributeCardHolders: boolean;
  onTeamCountChange: (v: number) => void;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
  onDistributeCardHoldersChange: (v: boolean) => void;
}

function useNumberInput(value: number, onChange: (v: number) => void, min: number, max: number) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  };

  const handleBlur = () => {
    const parsed = parseInt(text, 10);
    if (isNaN(parsed)) {
      setText(String(value));
    } else {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(clamped);
      setText(String(clamped));
    }
  };

  return { text, handleChange, handleBlur };
}

export default function TeamConfig({
  teamCount,
  minPerTeam,
  maxPerTeam,
  distributeCardHolders,
  onTeamCountChange,
  onMinChange,
  onMaxChange,
  onDistributeCardHoldersChange,
}: TeamConfigProps) {
  const teamCountInput = useNumberInput(teamCount, onTeamCountChange, 1, 20);
  const minInput = useNumberInput(minPerTeam, onMinChange, 1, 50);
  const maxInput = useNumberInput(maxPerTeam, onMaxChange, 1, 50);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="teamCount">팀 수</Label>
          <Input
            id="teamCount"
            type="text"
            inputMode="numeric"
            value={teamCountInput.text}
            onChange={teamCountInput.handleChange}
            onBlur={teamCountInput.handleBlur}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="minPerTeam">팀별 최소 인원</Label>
          <Input
            id="minPerTeam"
            type="text"
            inputMode="numeric"
            value={minInput.text}
            onChange={minInput.handleChange}
            onBlur={minInput.handleBlur}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxPerTeam">팀별 최대 인원</Label>
          <Input
            id="maxPerTeam"
            type="text"
            inputMode="numeric"
            value={maxInput.text}
            onChange={maxInput.handleChange}
            onBlur={maxInput.handleBlur}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={distributeCardHolders}
          onChange={(e) => onDistributeCardHoldersChange(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary"
        />
        <span className="text-sm">법카 소지자 팀별 균등 분배</span>
      </label>
    </div>
  );
}
