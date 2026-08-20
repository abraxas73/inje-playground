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
import { parseProvider, parseMemberSourceProvider, type Provider, type MemberSourceProvider } from "@/lib/providers";
import type { useSettings, SettingKey } from "@/hooks/useSettings";

interface ProviderSettingsProps {
  settingsHook: ReturnType<typeof useSettings>;
}

const AXES: { key: SettingKey; label: string; hint: string }[] = [
  { key: "notify_provider", label: "채널 알림", hint: "팀 구성 결과·점심 결정을 채널에 게시" },
  {
    key: "member_source_provider",
    label: "멤버 가져오기",
    hint: "사다리/팀/점심의 구성원 목록 소스. '앱 사용자 명단' = 이 앱에 로그인한 적 있는 구성원(guest 제외, 외부 연동 불필요)",
  },
  { key: "dm_provider", label: "개인 DM", hint: "점심 알림·가이드 답변 1:1 메시지" },
];

const PROVIDER_LABEL: Record<Provider, string> = { dooray: "Dooray", teams: "Microsoft Teams" };
const MEMBER_SOURCE_LABEL: Record<MemberSourceProvider, string> = {
  dooray: "Dooray",
  users: "앱 사용자 명단",
  teams: "Microsoft Teams (Graph/웹훅)",
};

export default function ProviderSettings({ settingsHook }: ProviderSettingsProps) {
  const { settings, updateLocal } = settingsHook;

  const memberSource = parseMemberSourceProvider(settings.member_source_provider);
  const dm = parseProvider(settings.dm_provider);
  // 점심 DM 수신자 해석: Dooray DM은 Dooray 멤버 ID, Teams DM은 이메일(앱 사용자 명단·Teams 소스)이 필요
  const mismatch = (dm === "dooray") !== (memberSource === "dooray");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {AXES.map((axis) => (
          <div key={axis.key} className="space-y-2">
            <Label htmlFor={`provider-${axis.key}`}>{axis.label}</Label>
            <Select
              value={
                axis.key === "member_source_provider"
                  ? parseMemberSourceProvider(settings[axis.key])
                  : parseProvider(settings[axis.key])
              }
              onValueChange={(v) => updateLocal(axis.key, v)}
            >
              <SelectTrigger id={`provider-${axis.key}`} className="w-full h-9 text-sm">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {axis.key === "member_source_provider" ? (
                  <>
                    <SelectItem value="dooray">{MEMBER_SOURCE_LABEL.dooray}</SelectItem>
                    <SelectItem value="users">{MEMBER_SOURCE_LABEL.users}</SelectItem>
                    <SelectItem value="teams">{MEMBER_SOURCE_LABEL.teams}</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="dooray">{PROVIDER_LABEL.dooray}</SelectItem>
                    <SelectItem value="teams">{PROVIDER_LABEL.teams}</SelectItem>
                  </>
                )}
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
            점심 DM 조합이 맞지 않습니다. Dooray DM은 멤버 가져오기가 Dooray일 때만(멤버 ID 필요), Teams DM은
            &quot;앱 사용자 명단&quot; 또는 Teams 소스일 때만(이메일 필요) 보낼 수 있습니다. (가이드 답변 DM은 로그인
            이메일로 정상 동작)
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
