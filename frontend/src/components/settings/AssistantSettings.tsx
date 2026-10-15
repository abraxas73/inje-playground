"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import type { useSettings } from "@/hooks/useSettings";

const MODELS = [{ id: "claude-sonnet-5-5", label: "Sonnet 5.5(기본)" }, { id: "claude-opus-5-5", label: "Opus 5.5" }];

/** 이노봇(웹 채팅·앱) — 켜기/끄기, 하루 턴 상한, 허용 모델, 대화 보존 기간. */
export default function AssistantSettings({ settingsHook }: { settingsHook: ReturnType<typeof useSettings> }) {
  const { settings, updateLocal } = settingsHook;
  const on = settings.assistant_enabled.trim().toLowerCase() !== "off";
  const picked = settings.assistant_models.split(",").map((x) => x.trim()).filter(Boolean);
  const allowed = (id: string) => !picked.length || picked.includes(id);
  const toggle = (id: string, v: boolean) => {
    const next = MODELS.map((m) => m.id).filter((x) => (x === id ? v : allowed(x)));
    updateLocal("assistant_models", next.length === MODELS.length ? "" : next.join(","));
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch id="assistant-enabled" checked={on} onCheckedChange={(v) => updateLocal("assistant_enabled", v ? "on" : "off")} aria-label="이노봇(웹 채팅·앱)을 씁니다" />
        <Label htmlFor="assistant-enabled">이노봇(웹 채팅·앱)을 씁니다</Label>
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor="assistant-daily" className="shrink-0">사용자당 하루 턴 상한</Label>
        <Input id="assistant-daily" className="w-28" inputMode="numeric" placeholder="200" value={settings.assistant_daily_turns} onChange={(e) => updateLocal("assistant_daily_turns", e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor="assistant-retention" className="shrink-0">대화 보존 기간(일)</Label>
        <Input id="assistant-retention" className="w-28" inputMode="numeric" placeholder="90" value={settings.assistant_retention_days} onChange={(e) => updateLocal("assistant_retention_days", e.target.value.replace(/\D/g, ""))} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">사용자가 고를 수 있는 모델</legend>
        {MODELS.map((m) => (
          <div key={m.id} className="flex items-center gap-3">
            <Switch id={`model-${m.id}`} checked={allowed(m.id)} disabled={m.id === "claude-sonnet-5-5"} onCheckedChange={(v) => toggle(m.id, v)} aria-label={m.label} />
            <Label htmlFor={`model-${m.id}`}>{m.label}</Label>
          </div>
        ))}
      </fieldset>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          이노봇은 Claude로 요청을 해석해 Teams·Confluence·SharePoint와 아마란스(앱, 웹은 데스크톱 앱이 켜져 있을 때 조회만) 작업을 합니다. 쓰기는 사용자가 확인 카드에서 &lsquo;실행&rsquo;을 눌러야 합니다. 대화는 사용자 본인만 볼 수 있게 서버에 저장되고 보존 기간이 지나면 지워집니다. 주민번호·카드번호·계좌번호·휴대전화는 Claude에 보내기 전에 가립니다. 감사 로그에는 쓴 도구 이름과 토큰 수만 남깁니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}
