"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3 } from "lucide-react";
import CodeUsageTab from "@/components/admin/claude-usage/CodeUsageTab";
import MembersCsvTab from "@/components/admin/claude-usage/MembersCsvTab";
import OrgSettingsTab from "@/components/admin/claude-usage/OrgSettingsTab";
import type { ClaudeOrg } from "@/types/claude-usage";

export default function ClaudeUsagePage() {
  const [orgs, setOrgs] = useState<ClaudeOrg[]>([]);
  const loadOrgs = useCallback(() => {
    fetch("/api/admin/claude-usage/orgs").then((r) => r.json()).then((j) => setOrgs(j.orgs ?? [])).catch(() => setOrgs([]));
  }, []);
  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><BarChart3 className="h-5 w-5" />Claude 사용량</h1>
        <p className="text-sm text-muted-foreground">Team 조직 7개의 사용자별 Claude Code 사용량(실시간, OTel)과 채팅·Cowork 활동(월간 CSV)</p>
      </div>
      <Tabs defaultValue="code">
        <TabsList>
          <TabsTrigger value="code">Claude Code</TabsTrigger>
          <TabsTrigger value="members">채팅 · Cowork (CSV)</TabsTrigger>
          <TabsTrigger value="orgs">조직 · 설정</TabsTrigger>
        </TabsList>
        <TabsContent value="code"><CodeUsageTab /></TabsContent>
        <TabsContent value="members"><MembersCsvTab orgs={orgs} /></TabsContent>
        <TabsContent value="orgs"><OrgSettingsTab orgs={orgs} onOrgsChange={loadOrgs} /></TabsContent>
      </Tabs>
    </div>
  );
}
