"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { orgSelectOptions } from "@/lib/claude-usage/org-options";
import type { ClaudeOrg } from "@/types/claude-usage";

/** 관리자 사용량 탭 공용 조직 선택 — Team 조직 전체·개별, 자동 등록된 개인 조직은 "기타(개인 계정)" 하나로, unknown은 "계정 정보 없는 세션" */
export default function OrgSelect({ orgs, value, onChange, personal = false, unknown = false, className = "w-[200px]" }: {
  orgs: ClaudeOrg[]; value: string; onChange: (value: string) => void; personal?: boolean; unknown?: boolean; className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-8 ${className} text-xs`}><SelectValue placeholder="Claude 조직" /></SelectTrigger>
      <SelectContent>
        {orgSelectOptions(orgs, { personal, unknown }).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
