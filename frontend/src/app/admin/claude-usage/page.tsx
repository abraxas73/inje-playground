"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SquareTerminal } from "lucide-react";
import CodeUsageTab from "@/components/admin/claude-usage/CodeUsageTab";
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
        <h1 className="flex items-center gap-2 text-xl font-semibold"><SquareTerminal className="h-5 w-5" />Claude Code 사용량</h1>
        <p className="text-sm text-muted-foreground">Team 조직 7개의 사용자별 Claude Code 사용량 — 관리형 설정 OTel로 실시간 수집. 채팅 · Cowork 활동(CSV)은 &quot;Claude 사용량 (Chat/Cowork)&quot; 메뉴, 멤버 · 초대와 조직 · 설정은 &quot;조직/팀&quot; 메뉴로 이동했습니다.</p>
        {orgsError && <p className="text-sm text-destructive">{orgsError}</p>}
      </div>
      <Tabs defaultValue="code">
        <TabsList>
          <TabsTrigger value="code">Claude Code</TabsTrigger>
          <TabsTrigger value="teams">팀별 집계</TabsTrigger>
          <TabsTrigger value="tools">도구 사용</TabsTrigger>
          <TabsTrigger value="hourly">시간대 패턴</TabsTrigger>
          <TabsTrigger value="prompts">프롬프트</TabsTrigger>
        </TabsList>
        <TabsContent value="code"><CodeUsageTab /></TabsContent>
        <TabsContent value="teams"><TeamSummaryTab orgs={orgs} /></TabsContent>
        <TabsContent value="tools"><ToolUsageTab orgs={orgs} /></TabsContent>
        <TabsContent value="hourly"><HourlyPatternTab orgs={orgs} /></TabsContent>
        <TabsContent value="prompts"><PromptsTab orgs={orgs} /></TabsContent>
      </Tabs>
    </div>
  );
}
