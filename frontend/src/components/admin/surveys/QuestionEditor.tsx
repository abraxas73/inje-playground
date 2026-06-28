"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import { default_config_for, QUESTION_TYPE_META } from "@/lib/survey";
import type { SurveyQuestion, QuestionType, QuestionConfig } from "@/types/survey";
import QuestionTypePicker from "./QuestionTypePicker";
import QuestionConfigEditor from "./QuestionConfigEditor";

export interface QuestionEditorProps {
  question: SurveyQuestion;
  onChange: (patch: Partial<SurveyQuestion>) => void;
  onDelete: () => void;
}

export default function QuestionEditor({ question, onChange, onDelete }: QuestionEditorProps) {
  const [open, setOpen] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const meta = QUESTION_TYPE_META[question.type];

  const handleTypeChange = (type: QuestionType) => {
    if (type === question.type) {
      setShowTypePicker(false);
      return;
    }
    onChange({ type, config: default_config_for(type) });
    setShowTypePicker(false);
  };

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 shrink-0 text-muted-foreground"
          aria-label="펼치기"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px] h-5 shrink-0">
              {meta.label}
            </Badge>
            {question.required && (
              <Badge variant="outline" className="text-[10px] h-5 shrink-0 text-rose-600 border-rose-200">
                필수
              </Badge>
            )}
            {question.section && (
              <Badge variant="outline" className="text-[10px] h-5 shrink-0">
                {question.section}
              </Badge>
            )}
          </div>
          <Input
            value={question.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="문항 제목"
            className="h-9 text-sm font-medium"
          />
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>문항을 삭제할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                이 작업은 되돌릴 수 없습니다. 문항과 관련 응답이 함께 삭제됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>삭제</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {open && (
        <div className="space-y-4 border-t px-3 py-3 pl-9">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">문항 타입</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setShowTypePicker((v) => !v)}
              >
                <Settings2 className="h-3.5 w-3.5" />
                타입 변경
              </Button>
            </div>
            {showTypePicker && (
              <QuestionTypePicker value={question.type} onSelect={handleTypeChange} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`section-${question.id}`} className="text-xs">
                섹션
              </Label>
              <Input
                id={`section-${question.id}`}
                value={question.section ?? ""}
                onChange={(e) => onChange({ section: e.target.value || null })}
                placeholder="예: S0. 배경"
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-end justify-between rounded-lg border px-3 pb-1.5 pt-2">
              <Label htmlFor={`req-${question.id}`} className="text-xs">
                필수 응답
              </Label>
              <Switch
                id={`req-${question.id}`}
                checked={question.required}
                onCheckedChange={(v) => onChange({ required: v })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`desc-${question.id}`} className="text-xs">
              설명 (선택)
            </Label>
            <Textarea
              id={`desc-${question.id}`}
              value={question.description ?? ""}
              onChange={(e) => onChange({ description: e.target.value || null })}
              placeholder="문항 보조 설명"
              rows={2}
              className="text-sm"
            />
          </div>

          <QuestionConfigEditor
            type={question.type}
            config={question.config}
            onChange={(config: QuestionConfig) => onChange({ config })}
          />
        </div>
      )}
    </div>
  );
}
