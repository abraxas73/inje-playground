"use client";

import type { FieldRendererProps } from "./SingleChoiceField";
import { Input } from "@/components/ui/input";

export default function TextField({
  question,
  value,
  onChange,
  disabled,
}: FieldRendererProps<{ type: "text"; value: string }>) {
  return (
    <Input
      type="text"
      disabled={disabled}
      maxLength={question.config.max_length}
      placeholder={question.config.placeholder}
      value={value.value}
      onChange={(e) => onChange({ type: "text", value: e.target.value })}
    />
  );
}
