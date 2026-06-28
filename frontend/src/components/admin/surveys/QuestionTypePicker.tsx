"use client";

import {
  CircleDot,
  ListChecks,
  SlidersHorizontal,
  Gauge,
  Hash,
  Type,
  AlignLeft,
  GitCompareArrows,
  type LucideIcon,
} from "lucide-react";
import { QUESTION_TYPE_META } from "@/lib/survey";
import type { QuestionType } from "@/types/survey";

export interface QuestionTypePickerProps {
  value?: QuestionType;
  onSelect: (type: QuestionType) => void;
}

const TYPE_ICON: Record<QuestionType, LucideIcon> = {
  single_choice: CircleDot,
  multi_choice: ListChecks,
  scale: SlidersHorizontal,
  nps: Gauge,
  number: Hash,
  text: Type,
  textarea: AlignLeft,
  pre_post_scale: GitCompareArrows,
};

const TYPE_ORDER: QuestionType[] = [
  "single_choice",
  "multi_choice",
  "scale",
  "nps",
  "number",
  "text",
  "textarea",
  "pre_post_scale",
];

export default function QuestionTypePicker({ value, onSelect }: QuestionTypePickerProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {TYPE_ORDER.map((type) => {
        const meta = QUESTION_TYPE_META[type];
        const Icon = TYPE_ICON[type];
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onSelect(type)}
            title={meta.description}
            className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors ${
              active
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "hover:bg-muted/40"
            }`}
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
