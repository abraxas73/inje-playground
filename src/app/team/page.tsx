"use client";

import { useState, useEffect, useCallback } from "react";
import { useParticipants } from "@/hooks/useParticipants";
import ParticipantInput from "@/components/shared/ParticipantInput";
import ParticipantList from "@/components/shared/ParticipantList";
import DoorayImportButton from "@/components/shared/DoorayImportButton";
import TeamConfig from "@/components/team/TeamConfig";
import TeamResults from "@/components/team/TeamResults";
import { divideTeams, validateTeamConfig } from "@/lib/team-divider";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shuffle, RefreshCw, AlertCircle, Users, Settings2 } from "lucide-react";
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

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CARD_HOLDERS_KEY);
      if (stored) {
        setCardHolders(new Set(JSON.parse(stored)));
      }
    } catch {}
  }, []);

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
    <div className="animate-fade-up">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center">
          <Users className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">팀 나누기</h1>
          <p className="text-sm text-muted-foreground">참여자를 랜덤으로 팀에 배정합니다</p>
        </div>
      </div>

      <div className="space-y-6">
        <Card className="animate-fade-up delay-100">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">참여자 명단</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>

        <Card className="animate-fade-up delay-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">팀 설정</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <TeamConfig
              teamCount={teamCount}
              minPerTeam={minPerTeam}
              maxPerTeam={maxPerTeam}
              onTeamCountChange={setTeamCount}
              onMinChange={setMinPerTeam}
              onMaxChange={setMaxPerTeam}
            />
          </CardContent>
        </Card>

        <div className="flex gap-3 animate-fade-up delay-300">
          <Button onClick={handleDivide} size="lg" className="rounded-xl shadow-md hover:shadow-lg transition-shadow">
            <Shuffle className="h-4 w-4 mr-2" />
            팀 나누기
          </Button>
          {result && (
            <Button onClick={handleDivide} variant="secondary" size="lg" className="rounded-xl">
              <RefreshCw className="h-4 w-4 mr-2" />
              다시 섞기
            </Button>
          )}
        </div>

        {error && (
          <Alert variant="destructive" className="animate-scale-in">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <section className="animate-scale-in">
            <h2 className="text-lg font-semibold mb-4">결과</h2>
            <TeamResults teams={result} />
          </section>
        )}
      </div>
    </div>
  );
}
