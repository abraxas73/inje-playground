"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, KeyRound } from "lucide-react";
import type { useSettings, SettingKey } from "@/hooks/useSettings";

interface TeamsSettingsProps {
  settingsHook: ReturnType<typeof useSettings>;
}

const FIELDS: { key: SettingKey; label: string; placeholder: string; hint: string }[] = [
  {
    key: "teams_notify_webhook_url",
    label: "채널 알림 웹훅 URL",
    placeholder: "https://prod-xx.westus.logic.azure.com:443/workflows/...",
    hint: "Power Automate \"HTTP 요청을 받은 경우\" → \"채팅 또는 채널에 메시지 게시\" 워크플로의 HTTP POST URL. 본문 {title, text, html}",
  },
  {
    key: "teams_dm_webhook_url",
    label: "개인 DM 웹훅 URL",
    placeholder: "https://prod-xx.westus.logic.azure.com:443/workflows/...",
    hint: "수신자 이메일로 1:1 메시지를 보내는 워크플로의 HTTP POST URL. 본문 {recipientEmail, text, html}",
  },
  {
    key: "teams_members_webhook_url",
    label: "멤버 목록 웹훅 URL (Graph 관리자 동의 대안)",
    placeholder: "https://prod-xx.westus.logic.azure.com:443/workflows/...",
    hint: "Power Automate \"HTTP 요청을 받은 경우\" → Office 365 Groups \"그룹 구성원 나열\" → \"응답\" 워크플로의 HTTP POST URL. 설정되면 Graph 대신 이 흐름으로 멤버를 가져오며 아래 테넌트/클라이언트 ID·시크릿은 불필요. 본문 {groupId}",
  },
  {
    key: "teams_tenant_id",
    label: "Entra 테넌트 ID",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    hint: "Microsoft Entra 관리 센터 > 개요 > 테넌트 ID (Graph 방식일 때만 필요)",
  },
  {
    key: "teams_graph_client_id",
    label: "Graph 앱 클라이언트 ID",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    hint: "로그인용 Entra 앱 등록의 애플리케이션(클라이언트) ID. GroupMember.Read.All(애플리케이션) 권한 + 테넌트 관리자 동의 필요 (Graph 방식일 때만)",
  },
  {
    key: "teams_group_id",
    label: "멤버를 가져올 팀/그룹 ID",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    hint: "Teams 팀의 Microsoft 365 그룹 개체 ID (Dooray 프로젝트 ID에 해당). 웹훅 방식에서는 본문 groupId로 전달됨",
  },
];

export default function TeamsSettings({ settingsHook }: TeamsSettingsProps) {
  const { settings, updateLocal } = settingsHook;

  return (
    <div className="space-y-4">
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-2">
          <Label htmlFor={`teams-${f.key}`}>{f.label}</Label>
          <Input
            id={`teams-${f.key}`}
            value={settings[f.key]}
            onChange={(e) => updateLocal(f.key, e.target.value)}
            placeholder={f.placeholder}
          />
          <p className="text-xs text-muted-foreground">{f.hint}</p>
        </div>
      ))}

      <Alert>
        <KeyRound className="h-4 w-4" />
        <AlertDescription>
          Graph 방식을 쓸 때만: 클라이언트 시크릿은 보안상 여기에 저장하지 않습니다. 서버 환경변수{" "}
          <code className="font-mono text-xs">TEAMS_GRAPH_CLIENT_SECRET</code>로 설정하세요 (로컬:
          frontend/.env.local, 운영: Vercel Environment Variables).
        </AlertDescription>
      </Alert>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          설정 절차는 docs/teams-integration.md 참고. 위 &quot;연동 채널 선택&quot;에서 축별로 Teams를 고르면 적용됩니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}
