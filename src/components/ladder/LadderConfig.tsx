"use client";

import { useState, type KeyboardEvent } from "react";

interface LadderConfigProps {
  results: string[];
  onResultsChange: (results: string[]) => void;
  bridgeDensity: number;
  onBridgeDensityChange: (density: number) => void;
}

export default function LadderConfig({
  results,
  onResultsChange,
  bridgeDensity,
  onBridgeDensityChange,
}: LadderConfigProps) {
  const [resultInput, setResultInput] = useState("");

  const addResult = () => {
    if (!resultInput.trim()) return;
    const newResults = resultInput
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    onResultsChange([...results, ...newResults]);
    setResultInput("");
  };

  const removeResult = (index: number) => {
    onResultsChange(results.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      addResult();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          결과 (상/벌)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={resultInput}
            onChange={(e) => setResultInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="결과 입력 (쉼표로 여러 개 추가)"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={addResult}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            추가
          </button>
        </div>
        {results.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {results.map((result, index) => (
              <span
                key={`${result}-${index}`}
                className="inline-flex items-center gap-1 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-sm"
              >
                {result}
                <button
                  onClick={() => removeResult(index)}
                  className="text-amber-400 hover:text-red-500 transition-colors ml-1"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          다리 밀도: {Math.round(bridgeDensity * 100)}%
        </label>
        <input
          type="range"
          min={10}
          max={70}
          value={bridgeDensity * 100}
          onChange={(e) => onBridgeDensityChange(Number(e.target.value) / 100)}
          className="w-full"
        />
      </div>
    </div>
  );
}
