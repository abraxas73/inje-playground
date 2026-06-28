"use client";

import type { SurveyQuestion, AnswerValue, PrePostValue } from "@/types/survey";
import SingleChoiceField from "./renderers/SingleChoiceField";
import MultiChoiceField from "./renderers/MultiChoiceField";
import ScaleField from "./renderers/ScaleField";
import NpsField from "./renderers/NpsField";
import NumberField from "./renderers/NumberField";
import TextField from "./renderers/TextField";
import TextareaField from "./renderers/TextareaField";
import PrePostScaleField from "./renderers/PrePostScaleField";

export interface QuestionRendererProps {
  question: SurveyQuestion;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  error?: string;
  disabled?: boolean;
}

export default function QuestionRenderer({
  question,
  value,
  onChange,
  error,
  disabled,
}: QuestionRendererProps) {
  function body() {
    switch (value.type) {
      case "single_choice":
        return <SingleChoiceField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
      case "multi_choice":
        return <MultiChoiceField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
      case "scale":
        return <ScaleField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
      case "nps":
        return <NpsField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
      case "number":
        return <NumberField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
      case "text":
        return <TextField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
      case "textarea":
        return <TextareaField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
      case "pre_post_scale":
        return (
          <PrePostScaleField
            question={question}
            value={value as { type: "pre_post_scale"; value: PrePostValue }}
            onChange={onChange}
            error={error}
            disabled={disabled}
          />
        );
      default:
        value satisfies never;
        return null;
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="question-container">
      <div>
        <p className="text-sm font-medium">
          {question.title}
          {question.required && <span className="text-destructive ml-1">*</span>}
        </p>
        {question.description && (
          <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">{question.description}</p>
        )}
      </div>
      {body()}
      {error && (
        <p className="text-xs text-destructive" data-testid="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
