"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter, X } from "lucide-react";
import type { SurveyQuestion, SegmentFilter } from "@/types/survey";

export interface SegmentFilterBarProps {
  segmentQuestions: SurveyQuestion[];
  value: SegmentFilter[];
  onChange: (filters: SegmentFilter[]) => void;
}

export default function SegmentFilterBar({ segmentQuestions, value, onChange }: SegmentFilterBarProps) {
  if (segmentQuestions.length === 0) return null;

  const valuesFor = (qid: string) => value.find((f) => f.question_id === qid)?.values ?? [];

  const toggle = (qid: string, optValue: string) => {
    const current = valuesFor(qid);
    const next = current.includes(optValue)
      ? current.filter((v) => v !== optValue)
      : [...current, optValue];
    const others = value.filter((f) => f.question_id !== qid);
    onChange(next.length > 0 ? [...others, { question_id: qid, values: next }] : others);
  };

  const activeCount = value.reduce((s, f) => s + f.values.length, 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Filter className="h-3.5 w-3.5" /> 세그먼트
      </span>
      {segmentQuestions.map((q) => {
        const selected = valuesFor(q.id);
        return (
          <Popover key={q.id}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                {q.title}
                {selected.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {selected.length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              <div className="space-y-1.5">
                {(q.config.options ?? []).map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={selected.includes(opt.value)}
                      onCheckedChange={() => toggle(q.id, opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => onChange([])}>
          <X className="h-3 w-3 mr-1" /> 초기화
        </Button>
      )}
    </div>
  );
}
