"use client";

import type { FieldRendererProps } from "./SingleChoiceField";
import type { PrePostValue } from "@/types/survey";
import { cn } from "@/lib/utils";

interface RowProps {
  side: "before" | "after";
  label: string;
  current: number | null;
  points: number[];
  disabled?: boolean;
  onSelect: (side: "before" | "after", p: number) => void;
}

function ScaleRow({ side, label, current, points, disabled, onSelect }: RowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex gap-1.5">
        {points.map((p) => {
          const selected = current === p;
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(side, p)}
              className={cn(
                "flex-1 rounded-lg border py-2 text-sm font-medium transition-colors",
                selected
                  ? side === "before"
                    ? "border-slate-500 bg-slate-500 text-white"
                    : "border-primary bg-primary text-primary-foreground"
                  : "border-input hover:bg-muted/40",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {p}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function PrePostScaleField({
  question,
  value,
  onChange,
  disabled,
}: FieldRendererProps<{ type: "pre_post_scale"; value: PrePostValue }>) {
  const min = question.config.min ?? 1;
  const max = question.config.max ?? 5;
  const beforeLabel = question.config.before_label ?? "도입 전";
  const afterLabel = question.config.after_label ?? "현재";
  const points: number[] = [];
  for (let i = min; i <= max; i++) points.push(i);

  function setSide(side: "before" | "after", p: number) {
    onChange({ type: "pre_post_scale", value: { ...value.value, [side]: p } });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
      <ScaleRow
        side="before"
        label={beforeLabel}
        current={value.value.before}
        points={points}
        disabled={disabled}
        onSelect={setSide}
      />
      <ScaleRow
        side="after"
        label={afterLabel}
        current={value.value.after}
        points={points}
        disabled={disabled}
        onSelect={setSide}
      />
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{question.config.min_label ?? min}</span>
        {question.config.mid_label && <span>{question.config.mid_label}</span>}
        <span>{question.config.max_label ?? max}</span>
      </div>
    </div>
  );
}
