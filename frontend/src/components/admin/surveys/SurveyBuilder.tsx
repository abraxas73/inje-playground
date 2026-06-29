"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GripVertical, ChevronUp, ChevronDown, Plus } from "lucide-react";
import type { SurveyQuestion, QuestionType } from "@/types/survey";
import QuestionEditor from "./QuestionEditor";
import QuestionTypePicker from "./QuestionTypePicker";

export interface SurveyBuilderProps {
  surveyId: string;
  questions: SurveyQuestion[];
  onReorder: (items: { id: string; order_index: number; section?: string | null }[]) => void;
  onQuestionChange: (id: string, patch: Partial<SurveyQuestion>) => void;
  onAddQuestion: (type: QuestionType, section?: string) => void;
  onDeleteQuestion: (id: string) => void;
}

export default function SurveyBuilder({
  questions,
  onReorder,
  onQuestionChange,
  onAddQuestion,
  onDeleteQuestion,
}: SurveyBuilderProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const ordered = [...questions].sort((a, b) => a.order_index - b.order_index);

  const emitReorder = (next: SurveyQuestion[]) => {
    onReorder(next.map((q, i) => ({ id: q.id, order_index: i, section: q.section })));
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const from = ordered.findIndex((q) => q.id === dragId);
    const to = ordered.findIndex((q) => q.id === targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      return;
    }
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    emitReorder(next);
    setDragId(null);
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = ordered.findIndex((q) => q.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j], next[i]];
    emitReorder(next);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {ordered.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            아직 문항이 없습니다. 아래에서 타입을 선택해 추가하세요.
          </div>
        ) : (
          ordered.map((q, idx) => (
            <div
              key={q.id}
              draggable
              onDragStart={() => setDragId(q.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(q.id)}
              className={`flex items-stretch gap-1 ${dragId === q.id ? "opacity-50" : ""}`}
              data-testid="survey-question-row"
              data-question-type={q.type}
            >
              <div className="flex flex-col items-center justify-start gap-1 pt-3 text-muted-foreground">
                <GripVertical className="h-4 w-4 cursor-grab" aria-label="드래그 핸들" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={idx === 0}
                  onClick={() => move(q.id, -1)}
                  aria-label="위로"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={idx === ordered.length - 1}
                  onClick={() => move(q.id, 1)}
                  aria-label="아래로"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex-1">
                <QuestionEditor
                  question={q}
                  onChange={(patch) => onQuestionChange(q.id, patch)}
                  onDelete={() => onDeleteQuestion(q.id)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="rounded-lg border bg-muted/20 p-3" data-testid="question-add-area">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Plus className="h-3.5 w-3.5" />
          문항 추가
        </p>
        <QuestionTypePicker onSelect={(type) => onAddQuestion(type)} />
      </div>
    </div>
  );
}
