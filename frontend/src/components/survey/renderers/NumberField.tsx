"use client";

import type { FieldRendererProps } from "./SingleChoiceField";
import { Input } from "@/components/ui/input";

export default function NumberField({
  question,
  value,
  onChange,
  disabled,
}: FieldRendererProps<{ type: "number"; value: number | null }>) {
  const unit = question.config.unit;
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="decimal"
        min={question.config.min}
        max={question.config.max}
        step={question.config.step}
        disabled={disabled}
        value={value.value === null ? "" : String(value.value)}
        placeholder={question.config.placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          onChange({ type: "number", value: raw === "" ? null : Number(raw) });
        }}
        className="max-w-[160px]"
      />
      {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
    </div>
  );
}
