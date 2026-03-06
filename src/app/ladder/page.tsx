"use client";

import { useState, useCallback } from "react";
import { useParticipants } from "@/hooks/useParticipants";
import { useBgm } from "@/hooks/useBgm";
import { useTts } from "@/hooks/useTts";
import ParticipantInput from "@/components/shared/ParticipantInput";
import ParticipantList from "@/components/shared/ParticipantList";
import DoorayImportButton from "@/components/shared/DoorayImportButton";
import LadderCanvas from "@/components/ladder/LadderCanvas";
import LadderConfig from "@/components/ladder/LadderConfig";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dice5, Music, Users, Settings2 } from "lucide-react";
import type { PresetName } from "@/lib/bgm-presets";
import { cn } from "@/lib/utils";

const BGM_PRESETS: { key: PresetName; label: string }[] = [
  { key: "tension", label: "긴장감" },
  { key: "exciting", label: "신나는" },
  { key: "calm", label: "잔잔한" },
];

export default function LadderPage() {
  const { participants, addParticipants, removeParticipant, clearAll, setAll } =
    useParticipants("ladder-participants");

  const [results, setResults] = useState<string[]>([]);
  const [bridgeDensity, setBridgeDensity] = useState(0.4);

  const bgm = useBgm();
  const tts = useTts();

  const handleAnimationStart = useCallback(() => {
    bgm.play();
  }, [bgm]);

  const handleAllRevealed = useCallback(
    (mappings: { participant: string; result: string }[]) => {
      bgm.stop();
      setTimeout(() => tts.speak(mappings), 500);
    },
    [bgm, tts]
  );

  return (
    <div className="animate-fade-up">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-violet-100 flex items-center justify-center">
          <Dice5 className="h-5 w-5 text-violet-600" />
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
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <ParticipantInput onAdd={addParticipants} />
              </div>
              <DoorayImportButton onImport={setAll} />
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
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
