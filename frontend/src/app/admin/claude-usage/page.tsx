"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3 } from "lucide-react";
import CodeUsageTab from "@/components/admin/claude-usage/CodeUsageTab";
import MembersCsvTab from "@/components/admin/claude-usage/MembersCsvTab";
import OrgSettingsTab from "@/components/admin/claude-usage/OrgSettingsTab";
import OrgMembersTab from "@/components/admin/claude-usage/OrgMembersTab";
import TeamSummaryTab from "@/components/admin/claude-usage/TeamSummaryTab";
import ToolUsageTab from "@/components/admin/claude-usage/ToolUsageTab";
import HourlyPatternTab from "@/components/admin/claude-usage/HourlyPatternTab";
import PromptsTab from "@/components/admin/claude-usage/PromptsTab";
import type { ClaudeOrg } from "@/types/claude-usage";

export default function ClaudeUsagePage() {
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
        <h1 className="flex items-center gap-2 text-xl font-semibold"><BarChart3 className="h-5 w-5" />Claude 사용량</h1>
        <p className="text-sm text-muted-foreground">Team 조직 7개의 사용자별 Claude Code 사용량(실시간, OTel)과 채팅·Cowork 활동(월간 CSV)</p>
        {orgsError && <p className="text-sm text-destructive">{orgsError}</p>}
      </div>
      <Tabs defaultValue="code">
        <TabsList>
          <TabsTrigger value="code">Claude Code</TabsTrigger>
          <TabsTrigger value="members">채팅 · Cowork (CSV)</TabsTrigger>
          <TabsTrigger value="invites">멤버 · 초대</TabsTrigger>
          <TabsTrigger value="teams">팀별 집계</TabsTrigger>
          <TabsTrigger value="tools">도구 사용</TabsTrigger>
          <TabsTrigger value="hourly">시간대 패턴</TabsTrigger>
          <TabsTrigger value="prompts">프롬프트</TabsTrigger>
          <TabsTrigger value="orgs">조직 · 설정</TabsTrigger>
        </TabsList>
        <TabsContent value="code"><CodeUsageTab /></TabsContent>
        <TabsContent value="members"><MembersCsvTab orgs={orgs} onOrgsChange={loadOrgs} /></TabsContent>
        <TabsContent value="invites"><OrgMembersTab orgs={orgs} /></TabsContent>
        <TabsContent value="teams"><TeamSummaryTab orgs={orgs} /></TabsContent>
        <TabsContent value="tools"><ToolUsageTab orgs={orgs} /></TabsContent>
        <TabsContent value="hourly"><HourlyPatternTab orgs={orgs} /></TabsContent>
        <TabsContent value="prompts"><PromptsTab orgs={orgs} /></TabsContent>
        <TabsContent value="orgs"><OrgSettingsTab orgs={orgs} onOrgsChange={loadOrgs} /></TabsContent>
      </Tabs>
    </div>
  );
}
