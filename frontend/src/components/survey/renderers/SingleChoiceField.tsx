"use client";

import type { SurveyQuestion } from "@/types/survey";
import { cn } from "@/lib/utils";

export interface FieldRendererProps<V> {
  question: SurveyQuestion;
  value: V;
  onChange: (value: V) => void;
  error?: string;
  disabled?: boolean;
}

export default function SingleChoiceField({
  question,
  value,
  onChange,
  disabled,
}: FieldRendererProps<{ type: "single_choice"; value: string | null }>) {
  const options = question.config.options ?? [];
  return (
    <div className="flex flex-col gap-2">
      {options.map((opt) => {
        const selected = value.value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ type: "single_choice", value: opt.value })}
            className={cn(
              "text-left rounded-lg border px-3 py-2.5 text-sm transition-colors",
              selected ? "border-primary bg-primary/5 font-medium" : "border-input hover:bg-muted/40",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
