"use client";

import type { FieldRendererProps } from "./SingleChoiceField";
import { cn } from "@/lib/utils";

export default function ScaleField({
  question,
  value,
  onChange,
  disabled,
}: FieldRendererProps<{ type: "scale"; value: number | null }>) {
  const min = question.config.min ?? 1;
  const max = question.config.max ?? 5;
  const points: number[] = [];
  for (let i = min; i <= max; i++) points.push(i);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {points.map((p) => {
          const selected = value.value === p;
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ type: "scale", value: p })}
              className={cn(
                "flex-1 rounded-lg border py-2.5 text-sm font-medium transition-colors",
                selected ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-muted/40",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {p}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{question.config.min_label ?? min}</span>
        {question.config.mid_label && <span>{question.config.mid_label}</span>}
        <span>{question.config.max_label ?? max}</span>
      </div>
    </div>
  );
}
