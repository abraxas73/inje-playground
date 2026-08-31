"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2 } from "lucide-react";
import DirectoryTable from "@/components/admin/directory/DirectoryTable";
import OrgMembersTab from "@/components/admin/claude-usage/OrgMembersTab";
import OrgSettingsTab from "@/components/admin/claude-usage/OrgSettingsTab";
import type { ClaudeOrg } from "@/types/claude-usage";

export default function DirectoryPage() {
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
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Building2 className="h-5 w-5" />조직/팀</h1>
        <p className="text-sm text-muted-foreground">사내 조직도(그룹웨어 아마란스 기준)와 Claude 조직의 멤버 · 초대 상태, 조직 · 설정 관리</p>
        {orgsError && <p className="text-sm text-destructive">{orgsError}</p>}
      </div>
      <Tabs defaultValue="directory">
        <TabsList>
          <TabsTrigger value="directory">사내 조직도</TabsTrigger>
          <TabsTrigger value="invites">멤버 · 초대</TabsTrigger>
          <TabsTrigger value="orgs">조직 · 설정</TabsTrigger>
        </TabsList>
        <TabsContent value="directory">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">그룹웨어 아마란스 조직도 기준 구성원의 부문 · 본부 · 센터/팀 · 직책 — Claude 조직과 별개의 회사 소속 정보. Claude 사용량 표의 &quot;소속&quot; 컬럼이 이 명부를 참조합니다.</p>
            <DirectoryTable />
          </div>
        </TabsContent>
        <TabsContent value="invites"><OrgMembersTab orgs={orgs} /></TabsContent>
        <TabsContent value="orgs"><OrgSettingsTab orgs={orgs} onOrgsChange={loadOrgs} /></TabsContent>
      </Tabs>
    </div>
  );
}
