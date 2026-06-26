"use client";

import type { FieldRendererProps } from "./SingleChoiceField";
import { cn } from "@/lib/utils";

export default function NpsField({
  value,
  onChange,
  disabled,
}: FieldRendererProps<{ type: "nps"; value: number | null }>) {
  const points = Array.from({ length: 11 }, (_, i) => i);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-11 gap-1">
        {points.map((p) => {
          const selected = value.value === p;
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ type: "nps", value: p })}
              className={cn(
                "rounded-md border py-2 text-xs font-medium transition-colors",
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
        <span>전혀 추천 안 함</span>
        <span>적극 추천</span>
      </div>
    </div>
  );
}
