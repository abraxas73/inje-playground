"use client";

import type { FieldRendererProps } from "./SingleChoiceField";
import { cn } from "@/lib/utils";

const EXCLUSIVE_VALUES = new Set(["none", "dont_know"]);

export default function MultiChoiceField({
  question,
  value,
  onChange,
  disabled,
}: FieldRendererProps<{ type: "multi_choice"; value: string[] }>) {
  const options = question.config.options ?? [];

  function toggle(optValue: string) {
    const selected = value.value.includes(optValue);
    let next: string[];
    if (selected) {
      next = value.value.filter((v) => v !== optValue);
    } else if (EXCLUSIVE_VALUES.has(optValue)) {
      next = [optValue];
    } else {
      next = [...value.value.filter((v) => !EXCLUSIVE_VALUES.has(v)), optValue];
    }
    onChange({ type: "multi_choice", value: next });
  }

  return (
    <div className="flex flex-col gap-2">
      {options.map((opt) => {
        const selected = value.value.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => toggle(opt.value)}
            className={cn(
              "flex items-center gap-2 text-left rounded-lg border px-3 py-2.5 text-sm transition-colors",
              selected ? "border-primary bg-primary/5 font-medium" : "border-input hover:bg-muted/40",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            <span
              className={cn(
                "h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px]",
                selected ? "bg-primary border-primary text-primary-foreground" : "border-input",
              )}
            >
              {selected ? "✓" : ""}
            </span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
