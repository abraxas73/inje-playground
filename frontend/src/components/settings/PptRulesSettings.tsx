"use client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { useSettings } from "@/hooks/useSettings";
import { RULES_TEXT } from "@/lib/ppt/rules-default";

/** PPT 생성 LLM 규칙(settings.ppt_llm_rules). 비우면 코드 기본본이 쓰이고, 저장하면 다음 생성부터 바로 적용된다(배포 불필요). */
export default function PptRulesSettings({ settingsHook }: { settingsHook: ReturnType<typeof useSettings> }) {
  const { settings, updateLocal } = settingsHook;
  const value = settings.ppt_llm_rules;
  const sameAsDefault = value.trim() !== "" && value.trim() === RULES_TEXT.trim();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="ppt-llm-rules">규칙 텍스트 <span className="font-normal text-muted-foreground">({value.trim() === "" ? "비어 있음 → 기본 규칙 사용" : sameAsDefault ? "기본 규칙과 같음 → 기본 규칙 사용" : `${value.length.toLocaleString("ko-KR")}자, 사용자 규칙 적용 중`})</span></Label>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => updateLocal("ppt_llm_rules", RULES_TEXT)}>기본 규칙 불러오기</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => updateLocal("ppt_llm_rules", "")} disabled={value.trim() === ""}>비우기(기본 사용)</Button>
        </div>
      </div>
      <Textarea id="ppt-llm-rules" value={value} onChange={(e) => updateLocal("ppt_llm_rules", e.target.value)} rows={16} className="font-mono text-xs" placeholder={RULES_TEXT.slice(0, 300) + " …"} spellCheck={false} />
      <p className="text-xs text-muted-foreground">
        원고를 deck JSON으로 옮길 때 모델에 주는 규칙(장표 고르기·글 규칙·수정 규약)입니다. 장표 목록·용량 카탈로그는 ppt-service가 템플릿에서 자동 생성해 별도로 붙으므로 여기 적지 않습니다.
        &quot;기본 규칙 불러오기&quot;로 현재 코드 기본본을 가져와 고치고 아래 저장 버튼을 누르세요. 고친 곳이 없으면(기본과 같으면) 비어 있는 것과 똑같이 기본 규칙이 쓰이고, 코드의 기본 규칙이 갱신되면 그대로 따라갑니다. 고친 규칙을 저장하면 그때부터는 이 저장본이 우선합니다. 저장 뒤 첫 생성은 프롬프트 캐시가 새로 만들어져 비용이 조금 더 듭니다.
      </p>
    </div>
  );
}
