"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessagesSquare } from "lucide-react";
import MembersCsvTab from "@/components/admin/claude-usage/MembersCsvTab";
import ChatTeamSummaryTab from "@/components/admin/claude-usage/ChatTeamSummaryTab";
import OfficeUsageTab from "@/components/admin/claude-usage/OfficeUsageTab";
import type { ClaudeOrg } from "@/types/claude-usage";

export default function ClaudeChatUsagePage() {
  const [orgs, setOrgs] = useState<ClaudeOrg[]>([]);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const loadOrgs = useCallback(() => {
    fetch("/api/admin/claude-usage/orgs")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j;
      })
      .then((j) => {
        setOrgsError(null);
        setOrgs(j.orgs ?? []);
      })
      .catch((e) => setOrgsError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><MessagesSquare className="h-5 w-5" />Claude 사용량 (Chat/Cowork)</h1>
        <p className="text-sm text-muted-foreground">claude.ai 채팅 · Cowork 멤버 활동(분석 대시보드 월간 CSV, 30일 롤링)과 Excel·Word·PowerPoint·Outlook 추가 기능(Office Agents, OTel 수집). Claude Code 실시간 사용량은 &quot;Claude Code 사용량&quot; 메뉴에서 봅니다.</p>
        <p className="text-xs text-muted-foreground">Claude in Chrome(사이드 패널)은 Cowork 세션으로 실행되어 Cowork 세션·메시지에 합산되고 별도 구분은 없습니다. Excel·Word·PowerPoint 추가 기능(Office Agents)은 CSV가 아니라 조직 설정의 OTel 수집기로 받으며, 멤버 표의 &quot;Office 턴&quot; 컬럼과 &quot;Office Agents&quot; 탭에서 봅니다(7개 조직 등록, 2026-09-07).</p>
        {orgsError && <p className="text-sm text-destructive">{orgsError}</p>}
      </div>
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">채팅 · Cowork (CSV)</TabsTrigger>
          <TabsTrigger value="teams">팀별 집계</TabsTrigger>
          <TabsTrigger value="office">Office Agents</TabsTrigger>
        </TabsList>
        <TabsContent value="members"><MembersCsvTab orgs={orgs} /></TabsContent>
        <TabsContent value="teams"><ChatTeamSummaryTab orgs={orgs} /></TabsContent>
        <TabsContent value="office"><OfficeUsageTab orgs={orgs} /></TabsContent>
      </Tabs>
    </div>
  );
}
