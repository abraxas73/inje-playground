"use client";

import { useState, useRef, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, X, Trophy, Skull, Minus, FolderOpen, Loader2 } from "lucide-react";
import type { LadderResult, ResultType } from "@/types/ladder";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS: { key: ResultType; label: string; icon: typeof Trophy; color: string }[] = [
  { key: "reward", label: "상", icon: Trophy, color: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  { key: "punishment", label: "벌", icon: Skull, color: "border-rose-300 bg-rose-50 text-rose-800" },
  { key: "normal", label: "일반", icon: Minus, color: "border-gray-300 bg-gray-50 text-gray-700" },
];

interface LadderConfigProps {
  results: LadderResult[];
  onResultsChange: (results: LadderResult[]) => void;
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
  const [selectedType, setSelectedType] = useState<ResultType>("normal");

  const addResult = () => {
    if (!resultInput.trim()) return;
    const newResults = resultInput
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
      .map((text) => ({ text, type: selectedType }));
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

  const getBadgeStyle = (type: ResultType) => {
    const opt = TYPE_OPTIONS.find((o) => o.key === type);
    return opt?.color || TYPE_OPTIONS[2].color;
  };

  const getBadgeIcon = (type: ResultType) => {
    if (type === "reward") return <Trophy className="h-2.5 w-2.5 mr-0.5" />;
    if (type === "punishment") return <Skull className="h-2.5 w-2.5 mr-0.5" />;
    return null;
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>결과 (상/벌)</Label>
          <LoadResultsDialog onSelect={onResultsChange} />
        </div>
        <div className="flex gap-1.5 mb-2">
          {TYPE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <Button
                key={opt.key}
                variant="outline"
                size="sm"
                onClick={() => setSelectedType(opt.key)}
                className={cn(
                  "rounded-full text-xs gap-1",
                  selectedType === opt.key && opt.color,
                  selectedType === opt.key && "ring-2 ring-offset-1 ring-current"
                )}
              >
                <Icon className="h-3 w-3" />
                {opt.label}
              </Button>
            );
          })}
        </div>
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
                key={`${result.text}-${index}`}
                variant="outline"
                className={cn("py-1.5 px-3", getBadgeStyle(result.type))}
              >
                {getBadgeIcon(result.type)}
                {result.text}
                <button
                  onClick={() => removeResult(index)}
                  className="ml-1.5 rounded-full hover:bg-black/10 p-1.5 -mr-1 transition-colors"
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

interface HistorySession {
  id: string;
  title: string | null;
  results: LadderResult[];
  created_at: string;
}

function LoadResultsDialog({ onSelect }: { onSelect: (results: LadderResult[]) => void }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchTokenRef = useRef(0);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    const token = ++fetchTokenRef.current;
    setLoading(true);
    fetch("/api/ladder-sessions")
      .then((res) => res.json())
      .then((data) => {
        if (token === fetchTokenRef.current) setSessions(data);
      })
      .catch(() => {})
      .finally(() => {
        if (token === fetchTokenRef.current) setLoading(false);
      });
  };

  const handleSelect = (results: LadderResult[]) => {
    onSelect(results);
    setOpen(false);
  };

  // Extract unique reward/punishment results only (exclude normal)
  const getUniqueResults = (results: LadderResult[]) => {
    const seen = new Set<string>();
    return results.filter((r) => {
      if (r.type === "normal") return false;
      const key = `${r.type}:${r.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const getBadgeStyle = (type: ResultType) => {
    const opt = TYPE_OPTIONS.find((o) => o.key === type);
    return opt?.color || TYPE_OPTIONS[2].color;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs gap-1">
          <FolderOpen className="h-3 w-3" />
          상벌 불러오기
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>상벌 이력에서 불러오기</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중...
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            저장된 사다리 게임 이력이 없습니다
          </p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => {
              const date = new Date(session.created_at);
              const dateStr = date.toLocaleDateString("ko-KR", {
                year: "numeric", month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit",
              });
              const uniqueResults = getUniqueResults(session.results);

              return (
                <button
                  key={session.id}
                  onClick={() => handleSelect(uniqueResults)}
                  className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">
                      {session.title || dateStr}
                    </span>
                    {session.title && (
                      <span className="text-[10px] text-muted-foreground">{dateStr}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {uniqueResults.map((r, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className={cn("text-[10px] px-1.5 py-0", getBadgeStyle(r.type))}
                      >
                        {r.type === "reward" && <Trophy className="h-2 w-2 mr-0.5" />}
                        {r.type === "punishment" && <Skull className="h-2 w-2 mr-0.5" />}
                        {r.text}
                      </Badge>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
