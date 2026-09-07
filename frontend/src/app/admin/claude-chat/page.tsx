"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessagesSquare } from "lucide-react";
import MembersCsvTab from "@/components/admin/claude-usage/MembersCsvTab";
import ChatTeamSummaryTab from "@/components/admin/claude-usage/ChatTeamSummaryTab";
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
        <p className="text-sm text-muted-foreground">claude.ai 채팅 · Cowork 멤버 활동 — 분석 대시보드 월간 CSV(30일 롤링). Claude Code 실시간 사용량은 &quot;Claude Code 사용량&quot; 메뉴에서 봅니다.</p>
        <p className="text-xs text-muted-foreground">Claude in Chrome(사이드 패널)은 Cowork 세션으로 실행되어 Cowork 세션·메시지에 합산되고 별도 구분은 없습니다. Excel·Word·PowerPoint 추가 기능 사용은 이 CSV에 없고, 조직 설정에 OTel 수집기를 등록한 조직(현재 Innogrid-ax)만 &quot;Claude Code 사용량 &gt; Office 추가 기능&quot; 탭에서 봅니다.</p>
        {orgsError && <p className="text-sm text-destructive">{orgsError}</p>}
      </div>
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">채팅 · Cowork (CSV)</TabsTrigger>
          <TabsTrigger value="teams">팀별 집계</TabsTrigger>
        </TabsList>
        <TabsContent value="members"><MembersCsvTab orgs={orgs} /></TabsContent>
        <TabsContent value="teams"><ChatTeamSummaryTab orgs={orgs} /></TabsContent>
      </Tabs>
    </div>
  );
}
