"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, KeyRound } from "lucide-react";
import type { useSettings, SettingKey } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

interface TeamsSettingsProps {
  settingsHook: ReturnType<typeof useSettings>;
}

const FIELDS: { key: SettingKey; label: string; placeholder: string; hint: string }[] = [
  {
    key: "teams_notify_webhook_url",
    label: "채널 알림 웹훅 URL",
    placeholder: "https://prod-xx.westus.logic.azure.com:443/workflows/...",
    hint: "Teams 워크플로 템플릿 \"웹후크 요청을 받으면 채널에 게시\"(표준 라이선스)로 만든 웹후크 URL. 앱이 Adaptive Card 봉투({type:message, attachments})를 보냄",
  },
  {
    key: "teams_dm_webhook_url",
    label: "개인 DM 웹훅 URL",
    placeholder: "https://prod-xx.westus.logic.azure.com:443/workflows/...",
    hint: "Power Automate: \"Teams 웹후크 요청을 받은 경우\" 트리거 → \"채팅 또는 채널에 적응형 카드 게시\"(Chat with Flow bot) 흐름의 URL. 수신자 이메일은 카드 body[0](숨김 TextBlock)",
  },
  {
    key: "teams_members_webhook_url",
    label: "멤버 목록 웹훅 URL (Graph 관리자 동의 대안)",
    placeholder: "https://prod-xx.westus.logic.azure.com:443/workflows/...",
    hint: "(Power Automate 프리미엄 필요) \"HTTP 요청을 받은 경우\" → Office 365 Groups \"그룹 구성원 나열\" → \"응답\" 흐름의 URL. 프리미엄이 없으면 멤버 가져오기 provider를 '앱 사용자 명단'으로 선택",
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

interface GroupChat { id: string; topic: string; members: string[] }

/** Teams 채팅 페이지 대상 그룹 채팅 — 관리자 본인의 Microsoft 연결로 "내 그룹 채팅"을 불러와 고른다(저장은 상단 저장 버튼). */
function GroupChatPicker({ settingsHook }: TeamsSettingsProps) {
  const { settings, updateLocal } = settingsHook;
  const [chats, setChats] = useState<GroupChat[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/teams/chats");
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `목록을 불러오지 못했습니다 (${res.status})`);
      setChats(j.chats as GroupChat[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };
  const pick = (c: GroupChat | null) => {
    updateLocal("teams_chat_id", c?.id ?? "");
    updateLocal("teams_chat_topic", c?.topic ?? "");
  };
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Label htmlFor="teams-teams_chat_id">Teams 채팅 페이지 대상 그룹 채팅</Label>
      <p className="text-xs text-muted-foreground">
        {settings.teams_chat_id ? `선택됨: ${settings.teams_chat_topic || settings.teams_chat_id}` : "아직 지정하지 않았습니다."} 사용자는 각자 설정 → Microsoft 계정 연결(Chat.ReadWrite 포함)로 본인 이름으로 읽고 보냅니다. 관리자 동의는 필요 없습니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>{loading ? "불러오는 중…" : "내 그룹 채팅에서 고르기"}</Button>
        {settings.teams_chat_id && <Button type="button" variant="ghost" size="sm" onClick={() => pick(null)}>해제</Button>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {chats && (chats.length ? (
        <ul className="max-h-60 space-y-1 overflow-auto">
          {chats.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => pick(c)} className={cn("w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted", settings.teams_chat_id === c.id && "border-primary bg-primary/5")}>
                <span className="font-medium">{c.topic}</span>
                <span className="block truncate text-xs text-muted-foreground">{c.members.join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">내가 참여한 그룹 채팅이 없습니다.</p>)}
      <Input id="teams-teams_chat_id" value={settings.teams_chat_id} onChange={(e) => updateLocal("teams_chat_id", e.target.value)} placeholder="19:xxxx@thread.v2 — 직접 입력도 가능" />
    </div>
  );
}

export default function TeamsSettings({ settingsHook }: TeamsSettingsProps) {
  const { settings, updateLocal } = settingsHook;

  return (
    <div className="space-y-4">
      <GroupChatPicker settingsHook={settingsHook} />
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
