"use client";

import { useState, useCallback, useRef } from "react";
import { useParticipants } from "@/hooks/useParticipants";
import { useUserMembers } from "@/hooks/useUserMembers";
import { useBgm } from "@/hooks/useBgm";
import { useTts } from "@/hooks/useTts";
import { useSfx } from "@/hooks/useSfx";
import ParticipantInput from "@/components/shared/ParticipantInput";
import ParticipantList from "@/components/shared/ParticipantList";
import DoorayImportButton from "@/components/shared/DoorayImportButton";
import DoorayProjectSelect from "@/components/shared/DoorayProjectSelect";
import LadderCanvas from "@/components/ladder/LadderCanvas";
import LadderConfig from "@/components/ladder/LadderConfig";
import LadderHistory from "@/components/ladder/LadderHistory";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

import { Separator } from "@/components/ui/separator";
import { Dice5, Music, Users, Settings2, Save, Loader2, History, UserCheck } from "lucide-react";
import type { PresetName } from "@/lib/bgm-presets";
import type { LadderData, LadderResult } from "@/types/ladder";
import { cn } from "@/lib/utils";
import { logAction } from "@/lib/action-log";

const BGM_PRESETS: { key: PresetName; label: string }[] = [
  { key: "tension", label: "긴장감" },
  { key: "exciting", label: "신나는" },
  { key: "calm", label: "잔잔한" },
];

export default function LadderPage() {
  const { participants, addParticipants, removeParticipant, clearAll, setAll } =
    useParticipants("ladder-participants");

  const userMembers = useUserMembers();
  const [overrideProjectId, setOverrideProjectId] = useState("");
  const [results, setResults] = useState<LadderResult[]>([]);
  const [bridgeDensity, setBridgeDensity] = useState(0.4);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const currentLadderRef = useRef<LadderData | null>(null);
  const currentMappingsRef = useRef<{ participant: string; result: LadderResult }[]>([]);
  const [hasResult, setHasResult] = useState(false);

  const bgm = useBgm();
  const tts = useTts();
  const sfx = useSfx();

  const handleAnimationStart = useCallback(() => {
    bgm.stop();
  }, [bgm]);

  const handleSingleRevealed = useCallback(
    (_participant: string, result: LadderResult) => {
      sfx.playResult(result.type);
    },
    [sfx]
  );

  const handleAllRevealed = useCallback(
    (mappings: { participant: string; result: LadderResult }[]) => {
      bgm.stop();
      currentMappingsRef.current = mappings;
      setHasResult(true);
      setSaved(false);
      logAction("사다리 전체 공개", "ladder", {
        mappings: mappings.map((m) => ({ participant: m.participant, result: m.result.text, type: m.result.type })),
      });
      const rewardOrPunishment = mappings.filter(
        (m) => m.result.type === "reward" || m.result.type === "punishment"
      );
      if (rewardOrPunishment.length > 0) {
        setTimeout(() => {
          tts.speak(rewardOrPunishment.map((m) => ({ participant: m.participant, result: m.result.text })));
        }, 500);
      }
    },
    [bgm, tts]
  );

  const handleLadderGenerated = useCallback((ladder: LadderData) => {
    currentLadderRef.current = ladder;
    currentMappingsRef.current = [];
    setHasResult(false);
    setSaved(false);
    sfx.resetIndex();
    logAction("사다리 생성", "ladder", { participantCount: ladder.columns, resultCount: ladder.results.length });
  }, [sfx]);

  const handleCanvasClick = useCallback(() => {
    sfx.playTrace();
  }, [sfx]);

  const handleSave = async () => {
    const ladder = currentLadderRef.current;
    if (!ladder || currentMappingsRef.current.length === 0) return;

    setSaving(true);
    try {
      await fetch("/api/ladder-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participants: ladder.participants,
          results: ladder.results,
          bridges: ladder.bridges,
          bridgeDensity,
          mappings: currentMappingsRef.current,
        }),
      });
      setSaved(true);
      setHistoryKey((k) => k + 1);
      logAction("사다리 결과 저장", "ladder", { participantCount: ladder.participants.length });
    } catch {} finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <Dice5 className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">사다리 게임</h1>
          <p className="text-sm text-muted-foreground">참여자 이름을 클릭해서 결과를 확인하세요</p>
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
            <DoorayProjectSelect value={overrideProjectId} onChange={setOverrideProjectId} />
            <div className="flex flex-wrap gap-2 items-start">
              <div className="flex-1 min-w-0">
                <ParticipantInput onAdd={addParticipants} />
              </div>
              <div className="flex gap-1.5 shrink-0">
                {userMembers.names.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-blue-300 text-blue-700 hover:bg-blue-50 h-10"
                    onClick={() => {
                      setAll(userMembers.names);
                    }}
                  >
                    <UserCheck className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">내 구성원</span> ({userMembers.names.length})
                  </Button>
                )}
                <DoorayImportButton
                  projectId={overrideProjectId || undefined}
                  onImport={setAll}
                  onImportedMembers={userMembers.saveImported}
                />
              </div>
            </div>
            <ParticipantList
              participants={participants}
              onRemove={removeParticipant}
              onClear={clearAll}
            />
          </CardContent>
        </Card>

        <Card className="animate-fade-up delay-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">게임 설정</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <LadderConfig
              results={results}
              onResultsChange={setResults}
              bridgeDensity={bridgeDensity}
              onBridgeDensityChange={setBridgeDensity}
            />

            <Separator className="my-5" />

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Music className="h-4 w-4 text-muted-foreground" />
                <Label>배경음악 (BGM)</Label>
              </div>
              <div className="flex flex-wrap gap-2">
                {BGM_PRESETS.map((p) => (
                  <Button
                    key={p.key}
                    variant={bgm.preset === p.key ? "default" : "outline"}
                    size="sm"
                    onClick={() => bgm.setPreset(p.key)}
                    className={cn(
                      "rounded-full",
                      bgm.preset === p.key && "shadow-sm"
                    )}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  볼륨
                </Label>
                <Slider
                  value={[bgm.volume]}
                  onValueChange={([v]) => bgm.setVolume(v)}
                  min={0}
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-8 text-right font-mono">
                  {bgm.volume}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-up delay-300">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Dice5 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">사다리</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <LadderCanvas
              participants={participants}
              results={results}
              bridgeDensity={bridgeDensity}
              onAnimationStart={handleAnimationStart}
              onAllRevealed={handleAllRevealed}
              onSingleRevealed={handleSingleRevealed}
              onLadderGenerated={handleLadderGenerated}
              onPathTraceStart={handleCanvasClick}
            />

            {hasResult && (
              <div className="mt-4">
                <Button
                  onClick={handleSave}
                  variant="outline"
                  className="rounded-xl"
                  disabled={saving || saved}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {saved ? "저장됨" : "결과 저장"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />

        <section className="animate-fade-up delay-400">
          <div className="flex items-center gap-2 mb-4">
            <History className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">사다리 게임 이력</h2>
          </div>
          <LadderHistory key={historyKey} />
        </section>
      </div>
    </div>
  );
}
