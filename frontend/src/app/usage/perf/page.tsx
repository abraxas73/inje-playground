"use client";

import { TrendingUp } from "lucide-react";
import PerfDashboard from "@/components/usage/PerfDashboard";

export default function MyPerfPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 md:px-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <TrendingUp className="h-5 w-5" />성과 지표
        </h1>
        <p className="text-sm text-muted-foreground">
          Claude 투입(비용·세션) 대비 업무 산출 — Jira 이슈, GitLab 커밋·MR, Confluence 문서. 조직장은 소속 구성원까지 보입니다. 상관관계이며 인과를 뜻하지 않습니다.
        </p>
      </div>
      <PerfDashboard apiPath="/api/usage/perf" />
    </div>
  );
}
