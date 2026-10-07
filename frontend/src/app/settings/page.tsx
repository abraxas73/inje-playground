"use client";

import { Settings } from "lucide-react";
import MyTeamCard from "@/components/settings/MyTeamCard";
import JiraAccountCard from "@/components/settings/JiraAccountCard";
import MicrosoftAccountCard from "@/components/settings/MicrosoftAccountCard";
import SharepointFolderCard from "@/components/settings/SharepointFolderCard";
import NotifyChannelCard from "@/components/settings/NotifyChannelCard";

export default function UserSettingsPage() {
  return (
    <div className="max-w-lg mx-auto py-8 px-4 space-y-4">
      <div className="flex items-center gap-2.5 mb-6">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">설정</h1>
      </div>

      {/* 내 팀 구성원 */}
      <MyTeamCard />

      {/* Microsoft 계정 (SharePoint 업로드) */}
      <MicrosoftAccountCard />
      <JiraAccountCard />

      {/* SharePoint 업로드 기본 폴더 */}
      <SharepointFolderCard />

      {/* 알림 채널(개인 워크플로우 URL) */}
      <NotifyChannelCard />

    </div>
  );
}
