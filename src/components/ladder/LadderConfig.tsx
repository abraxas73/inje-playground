"use client";

import { useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Plus, X } from "lucide-react";

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
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>결과 (상/벌)</Label>
        <div className="flex gap-2">
          <Input
            value={resultInput}
            onChange={(e) => setResultInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="결과 입력 (쉼표로 여러 개 추가)"
          />
          <Button onClick={addResult}>
            <Plus className="h-4 w-4 mr-1" />
            추가
          </Button>
        </div>
        {results.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {results.map((result, index) => (
              <Badge
                key={`${result}-${index}`}
                variant="outline"
                className="py-1.5 px-3 border-amber-200 bg-amber-50 text-amber-800"
              >
                {result}
                <button
                  onClick={() => removeResult(index)}
                  className="ml-1.5 rounded-full hover:bg-amber-200 p-0.5 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>다리 밀도</Label>
          <span className="text-sm text-muted-foreground font-mono">
            {Math.round(bridgeDensity * 100)}%
          </span>
        </div>
        <Slider
          value={[bridgeDensity * 100]}
          onValueChange={([v]) => onBridgeDensityChange(v / 100)}
          min={10}
          max={70}
          step={1}
        />
      </div>
    </div>
  );
}
