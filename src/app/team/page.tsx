"use client";

import { useState, useEffect, useCallback } from "react";
import { useParticipants } from "@/hooks/useParticipants";
import ParticipantInput from "@/components/shared/ParticipantInput";
import ParticipantList from "@/components/shared/ParticipantList";
import DoorayImportButton from "@/components/shared/DoorayImportButton";
import TeamConfig from "@/components/team/TeamConfig";
import TeamResults from "@/components/team/TeamResults";
import TeamHistory from "@/components/team/TeamHistory";
import { divideTeams, validateTeamConfig } from "@/lib/team-divider";
import { getRandomMythologyNames } from "@/lib/mythology-names";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shuffle, RefreshCw, AlertCircle, Users, Settings2, Save, Loader2, History } from "lucide-react";
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
  const [distributeCardHolders, setDistributeCardHolders] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [result, setResult] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

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
      cardHolders: distributeCardHolders ? activeCardHolders : [],
    };
    const validationError = validateTeamConfig(config);
    if (validationError) {
      setError(validationError);
      setResult(null);
      return;
    }
    setError(null);
    const { teams } = divideTeams(config);

    // 신화 캐릭터 이름 배정
    const mythNames = getRandomMythologyNames(teams.length);
    const namedTeams = teams.map((team, i) => ({
      ...team,
      name: mythNames[i] || team.name,
    }));

    setResult(namedTeams);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      await fetch("/api/team-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participants,
          teamCount,
          cardHolderDistribution: distributeCardHolders,
          teams: result.map((team) => ({
            name: team.name,
            members: team.members,
          })),
        }),
      });
      setSaved(true);
      setHistoryKey((k) => k + 1);
    } catch {} finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setSaved(false);
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-sky-50 flex items-center justify-center">
          <Users className="h-5 w-5 text-sky-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">팀 구성</h1>
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
            <div className="flex gap-2 items-center mb-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">프로젝트 ID</Label>
              <Input
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="비워두면 설정값 사용"
                className="h-8 text-xs max-w-60"
              />
            </div>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <ParticipantInput onAdd={addParticipants} />
              </div>
              <DoorayImportButton
                projectId={projectId}
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
              distributeCardHolders={distributeCardHolders}
              onTeamCountChange={setTeamCount}
              onMinChange={setMinPerTeam}
              onMaxChange={setMaxPerTeam}
              onDistributeCardHoldersChange={setDistributeCardHolders}
            />
          </CardContent>
        </Card>

        <div className="flex gap-3 animate-fade-up delay-300">
          <Button onClick={handleDivide} size="lg" className="rounded-xl shadow-md hover:shadow-lg transition-shadow">
            <Shuffle className="h-4 w-4 mr-2" />
            팀 구성하기
          </Button>
          {result && (
            <>
              <Button onClick={handleDivide} variant="secondary" size="lg" className="rounded-xl">
                <RefreshCw className="h-4 w-4 mr-2" />
                다시 섞기
              </Button>
              <Button
                onClick={handleSave}
                variant="outline"
                size="lg"
                className="rounded-xl"
                disabled={saving || saved}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {saved ? "저장됨" : "저장"}
              </Button>
            </>
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

        <Separator />

        <section className="animate-fade-up delay-400">
          <div className="flex items-center gap-2 mb-4">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">팀 구성 이력</h2>
          </div>
          <TeamHistory key={historyKey} />
        </section>
      </div>
    </div>
  );
}
