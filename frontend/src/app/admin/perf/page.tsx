"use client";

import { TrendingUp } from "lucide-react";
import PerfDashboard from "@/components/usage/PerfDashboard";

export default function AdminPerfPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><TrendingUp className="h-5 w-5" />성과 지표 (전체)</h1>
        <p className="text-sm text-muted-foreground">
          전 구성원의 Claude 투입(비용·세션) 대비 업무 산출 — Jira 이슈, GitLab 커밋·MR, Confluence 문서. 팀 필터로 좁혀 볼 수 있습니다. 상관관계이며 인과를 뜻하지 않습니다.
        </p>
      </div>
      <PerfDashboard apiPath="/api/admin/work-metrics/perf" />
    </div>
  );
}
