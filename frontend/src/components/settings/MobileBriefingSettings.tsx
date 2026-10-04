"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import type { useSettings } from "@/hooks/useSettings";

/** 모바일 앱 홈 브리핑 — Claude가 "데일리 브리핑"을 쓸지. 끄면 앱은 그 카드를 숨기고 격언·규칙 섹션만 보여 준다. */
export default function MobileBriefingSettings({ settingsHook }: { settingsHook: ReturnType<typeof useSettings> }) {
  const { settings, updateLocal } = settingsHook;
  const on = settings.mobile_briefing_llm.trim().toLowerCase() !== "off";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch id="mobile-briefing-llm" checked={on} onCheckedChange={(v) => updateLocal("mobile_briefing_llm", v ? "on" : "off")} aria-label="Claude가 '데일리 브리핑'을 씁니다" />
        <Label htmlFor="mobile-briefing-llm">Claude가 &lsquo;데일리 브리핑&rsquo;을 씁니다</Label>
      </div>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          켜져 있으면 앱이 하루 한 번(사용자마다) 오늘 일정·팀원 부재·미결 결재·안 읽은 메일·Teams 답장 대기·공지의 <b>제목 수준 요약</b>을 서버로 보내고, 서버가 Claude(Sonnet 5.5)로 2~3문장을 만들어 돌려줍니다. 메일·결재 본문은 보내지 않습니다. 끄면 홈의 &lsquo;데일리 브리핑&rsquo; 카드가 숨겨지고 격언(오늘의 한 줄)과 나머지 섹션(지금 필요한 것·일정·결재·메일·Teams·공지)은 그대로 보입니다. <code>ANTHROPIC_API_KEY</code>가 없어도 카드는 숨겨집니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}
