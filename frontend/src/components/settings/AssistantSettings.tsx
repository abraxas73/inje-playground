"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import type { useSettings } from "@/hooks/useSettings";

/** 모바일 앱 비서(이노봇) — 전체 켜기/끄기와 사용자당 하루 턴 상한. */
export default function AssistantSettings({ settingsHook }: { settingsHook: ReturnType<typeof useSettings> }) {
  const { settings, updateLocal } = settingsHook;
  const on = settings.assistant_enabled.trim().toLowerCase() !== "off";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch id="assistant-enabled" checked={on} onCheckedChange={(v) => updateLocal("assistant_enabled", v ? "on" : "off")} aria-label="앱에서 비서(이노봇)를 씁니다" />
        <Label htmlFor="assistant-enabled">앱에서 비서(이노봇)를 씁니다</Label>
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor="assistant-daily" className="shrink-0">사용자당 하루 턴 상한</Label>
        <Input id="assistant-daily" className="w-28" inputMode="numeric" placeholder="200" value={settings.assistant_daily_turns} onChange={(e) => updateLocal("assistant_daily_turns", e.target.value.replace(/\D/g, ""))} />
      </div>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          앱의 이노봇은 Claude(Sonnet 5.5)로 요청을 해석해 아마란스(회의실·일정·출퇴근·메일·결재 조회·게시판)와 Teams 작업을 합니다. 예약·일정·메일 발송 같은 쓰기는 사용자가 확인 카드에서 &lsquo;실행&rsquo;을 눌러야 합니다. 요청 한 번은 보통 3~5턴입니다. 대화와 도구 결과는 저장하지 않고, 감사 로그에는 쓴 도구 이름만 남깁니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}
