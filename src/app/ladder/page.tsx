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
import type { PresetName } from "@/lib/bgm-presets";

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
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">사다리 게임</h1>

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
              <DoorayImportButton onImport={setAll} />
            </div>
            <ParticipantList
              participants={participants}
              onRemove={removeParticipant}
              onClear={clearAll}
            />
          </div>
        </section>

        {/* 결과 설정 */}
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            게임 설정
          </h2>
          <LadderConfig
            results={results}
            onResultsChange={setResults}
            bridgeDensity={bridgeDensity}
            onBridgeDensityChange={setBridgeDensity}
          />

          {/* BGM 설정 */}
          <div className="mt-6 pt-4 border-t border-slate-100">
            <h3 className="text-sm font-medium text-slate-700 mb-3">
              배경음악 (BGM)
            </h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {BGM_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => bgm.setPreset(p.key)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    bgm.preset === p.key
                      ? "bg-blue-50 border-blue-300 text-blue-700 font-medium"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-500 whitespace-nowrap">
                볼륨
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={bgm.volume}
                onChange={(e) => bgm.setVolume(Number(e.target.value))}
                className="flex-1 h-1.5 accent-blue-600"
              />
              <span className="text-xs text-slate-500 w-8 text-right">
                {bgm.volume}%
              </span>
            </div>
          </div>
        </section>

        {/* 사다리 */}
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            사다리
          </h2>
          <LadderCanvas
            participants={participants}
            results={results}
            bridgeDensity={bridgeDensity}
            onAnimationStart={handleAnimationStart}
            onAllRevealed={handleAllRevealed}
          />
        </section>
      </div>
    </div>
  );
}
