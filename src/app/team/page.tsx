"use client";

import { useState, useEffect, useCallback } from "react";
import { useParticipants } from "@/hooks/useParticipants";
import ParticipantInput from "@/components/shared/ParticipantInput";
import ParticipantList from "@/components/shared/ParticipantList";
import DoorayImportButton from "@/components/shared/DoorayImportButton";
import TeamConfig from "@/components/team/TeamConfig";
import TeamResults from "@/components/team/TeamResults";
import { divideTeams, validateTeamConfig } from "@/lib/team-divider";
import type { Team } from "@/types/team";

const CARD_HOLDERS_KEY = "team-card-holders";

export default function TeamPage() {
  const {
    participants,
    addParticipants,
    removeParticipant,
    clearAll,
    setAll,
  } = useParticipants("team-participants");

  const [cardHolders, setCardHolders] = useState<Set<string>>(new Set());
  const [teamCount, setTeamCount] = useState(2);
  const [minPerTeam, setMinPerTeam] = useState(1);
  const [maxPerTeam, setMaxPerTeam] = useState(10);
  const [result, setResult] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load cardHolders from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CARD_HOLDERS_KEY);
      if (stored) {
        setCardHolders(new Set(JSON.parse(stored)));
      }
    } catch {}
  }, []);

  // Save cardHolders to localStorage
  const saveCardHolders = useCallback((holders: Set<string>) => {
    setCardHolders(holders);
    localStorage.setItem(CARD_HOLDERS_KEY, JSON.stringify([...holders]));
  }, []);

  const handleToggleCard = (name: string) => {
    const next = new Set(cardHolders);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    saveCardHolders(next);
  };

  const handleDivide = () => {
    // Filter cardHolders to only include current participants
    const activeCardHolders = [...cardHolders].filter((h) =>
      participants.includes(h)
    );
    const config = {
      participants,
      teamCount,
      minPerTeam,
      maxPerTeam,
      cardHolders: activeCardHolders,
    };
    const validationError = validateTeamConfig(config);
    if (validationError) {
      setError(validationError);
      setResult(null);
      return;
    }
    setError(null);
    const { teams } = divideTeams(config);
    setResult(teams);
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">팀 나누기</h1>

      <div className="space-y-6">
        {/* 참여자 입력 */}
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            참여자 명단
          </h2>
          <div className="space-y-4">
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <ParticipantInput onAdd={addParticipants} />
              </div>
              <DoorayImportButton
                onImport={(names) => {
                  setAll(names);
                  handleReset();
                }}
              />
            </div>
            <ParticipantList
              participants={participants}
              onRemove={(i) => {
                removeParticipant(i);
                handleReset();
              }}
              onClear={() => {
                clearAll();
                saveCardHolders(new Set());
                handleReset();
              }}
              cardHolders={cardHolders}
              onToggleCard={handleToggleCard}
            />
          </div>
        </section>

        {/* 팀 설정 */}
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            팀 설정
          </h2>
          <TeamConfig
            teamCount={teamCount}
            minPerTeam={minPerTeam}
            maxPerTeam={maxPerTeam}
            onTeamCountChange={setTeamCount}
            onMinChange={setMinPerTeam}
            onMaxChange={setMaxPerTeam}
          />
        </section>

        {/* 실행 버튼 */}
        <div className="flex gap-3">
          <button
            onClick={handleDivide}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            팀 나누기
          </button>
          {result && (
            <button
              onClick={handleDivide}
              className="px-6 py-3 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors"
            >
              다시 섞기
            </button>
          )}
        </div>

        {/* 에러 */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* 결과 */}
        {result && (
          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              결과
            </h2>
            <TeamResults teams={result} />
          </section>
        )}
      </div>
    </div>
  );
}
