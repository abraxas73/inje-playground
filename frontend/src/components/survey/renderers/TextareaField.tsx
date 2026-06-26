"use client";

import type { FieldRendererProps } from "./SingleChoiceField";
import { Textarea } from "@/components/ui/textarea";

export default function TextareaField({
  question,
  value,
  onChange,
  disabled,
}: FieldRendererProps<{ type: "textarea"; value: string }>) {
  const maxLen = question.config.max_length;
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        rows={4}
        disabled={disabled}
        maxLength={maxLen}
        placeholder={question.config.placeholder}
        value={value.value}
        onChange={(e) => onChange({ type: "textarea", value: e.target.value })}
      />
      {typeof maxLen === "number" && (
        <span className="text-[11px] text-muted-foreground self-end">
          {value.value.length} / {maxLen}
        </span>
      )}
    </div>
  );
}
