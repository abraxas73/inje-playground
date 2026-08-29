"use client";

import { Building2 } from "lucide-react";
import DirectoryTable from "@/components/admin/directory/DirectoryTable";

export default function DirectoryPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Building2 className="h-5 w-5" />조직/팀 (사내 조직도)</h1>
        <p className="text-sm text-muted-foreground">그룹웨어 아마란스 조직도 기준 구성원의 부문·본부·센터/팀·직책 — Claude 조직과 별개의 회사 소속 정보. Claude 사용량 표의 &quot;소속&quot; 컬럼이 이 명부를 참조합니다.</p>
      </div>
      <DirectoryTable />
    </div>
  );
}
