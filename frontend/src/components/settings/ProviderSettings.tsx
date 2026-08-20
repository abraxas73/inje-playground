"use client";

import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { parseProvider, type Provider } from "@/lib/providers";
import type { useSettings, SettingKey } from "@/hooks/useSettings";

interface ProviderSettingsProps {
  settingsHook: ReturnType<typeof useSettings>;
}

const AXES: { key: SettingKey; label: string; hint: string }[] = [
  { key: "notify_provider", label: "채널 알림", hint: "팀 구성 결과·점심 결정을 채널에 게시" },
  { key: "member_source_provider", label: "멤버 가져오기", hint: "사다리/팀/점심의 구성원 목록 소스" },
  { key: "dm_provider", label: "개인 DM", hint: "점심 알림·가이드 답변 1:1 메시지" },
];

const PROVIDER_LABEL: Record<Provider, string> = { dooray: "Dooray", teams: "Microsoft Teams" };

export default function ProviderSettings({ settingsHook }: ProviderSettingsProps) {
  const { settings, updateLocal } = settingsHook;

  const memberSource = parseProvider(settings.member_source_provider);
  const dm = parseProvider(settings.dm_provider);
  const mismatch = memberSource === "dooray" && dm === "teams";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {AXES.map((axis) => (
          <div key={axis.key} className="space-y-2">
            <Label htmlFor={`provider-${axis.key}`}>{axis.label}</Label>
            <Select
              value={parseProvider(settings[axis.key])}
              onValueChange={(v) => updateLocal(axis.key, v)}
            >
              <SelectTrigger id={`provider-${axis.key}`} className="w-full h-9 text-sm">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dooray">{PROVIDER_LABEL.dooray}</SelectItem>
                <SelectItem value="teams">{PROVIDER_LABEL.teams}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{axis.hint}</p>
          </div>
        ))}
      </div>

      {mismatch && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Teams DM은 이메일 기준이라 Dooray 멤버(이메일 없음)에게는 점심 DM을 보낼 수 없습니다.
            멤버 가져오기도 Microsoft Teams로 맞춰주세요. (가이드 답변 DM은 로그인 이메일로 정상 동작)
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
