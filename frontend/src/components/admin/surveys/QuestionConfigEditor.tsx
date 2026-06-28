"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2 } from "lucide-react";
import type { QuestionType, QuestionConfig, QuestionOption } from "@/types/survey";

export interface QuestionConfigEditorProps {
  type: QuestionType;
  config: QuestionConfig;
  onChange: (config: QuestionConfig) => void;
}

const HAS_OPTIONS: QuestionType[] = ["single_choice", "multi_choice"];
const HAS_SCALE: QuestionType[] = ["scale", "pre_post_scale"];

export default function QuestionConfigEditor({
  type,
  config,
  onChange,
}: QuestionConfigEditorProps) {
  const set = <K extends keyof QuestionConfig>(key: K, value: QuestionConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const options: QuestionOption[] = config.options ?? [];
  const setOptions = (next: QuestionOption[]) => onChange({ ...config, options: next });

  const numOrUndef = (raw: string): number | undefined =>
    raw === "" ? undefined : Number(raw);

  return (
    <div className="space-y-3">
      {/* ── 옵션 (single/multi) ── */}
      {HAS_OPTIONS.includes(type) && (
        <div className="space-y-2">
          <Label className="text-xs">선택지</Label>
          {options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={opt.value}
                onChange={(e) => {
                  const next = [...options];
                  next[idx] = { ...next[idx], value: e.target.value };
                  setOptions(next);
                }}
                placeholder="value"
                className="h-8 w-28 font-mono text-xs"
              />
              <Input
                value={opt.label}
                onChange={(e) => {
                  const next = [...options];
                  next[idx] = { ...next[idx], label: e.target.value };
                  setOptions(next);
                }}
                placeholder="표시 라벨"
                className="h-8 flex-1 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setOptions(options.filter((_, i) => i !== idx))}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() =>
              setOptions([...options, { value: `opt${options.length + 1}`, label: "" }])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            선택지 추가
          </Button>
          <div className="flex items-center justify-between pt-1">
            <Label htmlFor="allow_other" className="text-xs">
              기타 직접입력 허용
            </Label>
            <Switch
              id="allow_other"
              checked={config.allow_other ?? false}
              onCheckedChange={(v) => set("allow_other", v)}
            />
          </div>
        </div>
      )}

      {/* ── 척도 (scale/pre_post) ── */}
      {HAS_SCALE.includes(type) && (
        <div className="space-y-2">
          <Label className="text-xs">척도 범위</Label>
          <div className="grid grid-cols-3 gap-2">
            <Input
              type="number"
              value={config.min ?? ""}
              onChange={(e) => set("min", numOrUndef(e.target.value))}
              placeholder="min"
              className="h-8 text-sm"
            />
            <Input
              type="number"
              value={config.max ?? ""}
              onChange={(e) => set("max", numOrUndef(e.target.value))}
              placeholder="max"
              className="h-8 text-sm"
            />
            <Input
              type="number"
              value={config.step ?? ""}
              onChange={(e) => set("step", numOrUndef(e.target.value))}
              placeholder="step"
              className="h-8 text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input
              value={config.min_label ?? ""}
              onChange={(e) => set("min_label", e.target.value || undefined)}
              placeholder="최소 라벨"
              className="h-8 text-sm"
            />
            <Input
              value={config.mid_label ?? ""}
              onChange={(e) => set("mid_label", e.target.value || undefined)}
              placeholder="중간 라벨"
              className="h-8 text-sm"
            />
            <Input
              value={config.max_label ?? ""}
              onChange={(e) => set("max_label", e.target.value || undefined)}
              placeholder="최대 라벨"
              className="h-8 text-sm"
            />
          </div>
          {type === "pre_post_scale" && (
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={config.before_label ?? ""}
                onChange={(e) => set("before_label", e.target.value || undefined)}
                placeholder="이전 라벨 (기본: 도입 전)"
                className="h-8 text-sm"
              />
              <Input
                value={config.after_label ?? ""}
                onChange={(e) => set("after_label", e.target.value || undefined)}
                placeholder="이후 라벨 (기본: 현재)"
                className="h-8 text-sm"
              />
            </div>
          )}
        </div>
      )}

      {/* ── 숫자 ── */}
      {type === "number" && (
        <div className="space-y-2">
          <Label className="text-xs">숫자 입력</Label>
          <div className="grid grid-cols-3 gap-2">
            <Input
              type="number"
              value={config.min ?? ""}
              onChange={(e) => set("min", numOrUndef(e.target.value))}
              placeholder="min"
              className="h-8 text-sm"
            />
            <Input
              type="number"
              value={config.max ?? ""}
              onChange={(e) => set("max", numOrUndef(e.target.value))}
              placeholder="max"
              className="h-8 text-sm"
            />
            <Input
              value={config.unit ?? ""}
              onChange={(e) => set("unit", e.target.value || undefined)}
              placeholder="단위 (예: 시간/주)"
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}

      {/* ── 텍스트 ── */}
      {(type === "text" || type === "textarea") && (
        <div className="space-y-2">
          <Label className="text-xs">텍스트 입력</Label>
          <Input
            value={config.placeholder ?? ""}
            onChange={(e) => set("placeholder", e.target.value || undefined)}
            placeholder="placeholder"
            className="h-8 text-sm"
          />
          <Input
            type="number"
            value={config.max_length ?? ""}
            onChange={(e) => set("max_length", numOrUndef(e.target.value))}
            placeholder="최대 글자수"
            className="h-8 text-sm"
          />
        </div>
      )}

      {/* ── 분석 메타 (전 타입 공통) ── */}
      <Separator />
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">분석 메타</Label>
        <div className="flex items-center justify-between">
          <span className="text-xs">세그먼트 필터 후보</span>
          <Switch
            checked={config.segment ?? false}
            onCheckedChange={(v) => set("segment", v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs">순서형 (평균·상관 포함)</span>
          <Switch
            checked={config.ordinal ?? false}
            onCheckedChange={(v) => set("ordinal", v)}
          />
        </div>
        <Input
          value={config.analysis_metric ?? ""}
          onChange={(e) => set("analysis_metric", e.target.value || undefined)}
          placeholder="analysis_metric 키 (예: nps)"
          className="h-8 text-sm font-mono"
        />
        <Input
          value={(config.top_box ?? []).join(", ")}
          onChange={(e) =>
            set(
              "top_box",
              e.target.value.trim()
                ? e.target.value.split(",").map((v) => v.trim()).filter(Boolean)
                : undefined
            )
          }
          placeholder="top_box 값 (쉼표 구분, 예: 4, 5)"
          className="h-8 text-sm"
        />
        <Input
          type="number"
          value={config.target ?? ""}
          onChange={(e) => set("target", numOrUndef(e.target.value))}
          placeholder="target (신호등 벤치마크)"
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}
