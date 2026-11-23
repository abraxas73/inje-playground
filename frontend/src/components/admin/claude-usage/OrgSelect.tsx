"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { orgSelectOptions, TEAM_ORGS } from "@/lib/claude-usage/org-options";
import type { ClaudeOrg } from "@/types/claude-usage";

/**
 * 관리자 사용량 탭 공용 조직 선택 — Team 조직 전체·개별, 자동 등록된 개인 조직은 "기타(개인 계정)" 하나로, unknown은 "계정 정보 없는 세션".
 * personal·unknown을 켠 OTel 탭은 기본으로 우리 Team 조직만(값 "team") 보이고, "전체 조회"를 체크하면 개인 계정·계정 정보 없는 세션까지 고를 수 있다(2026-11-23).
 */
export default function OrgSelect({ orgs, value, onChange, personal = false, unknown = false, className = "w-[200px]" }: {
  orgs: ClaudeOrg[]; value: string; onChange: (value: string) => void; personal?: boolean; unknown?: boolean; className?: string;
}) {
  const scoped = personal || unknown;
  const [showAll, setShowAll] = useState(scoped && value !== TEAM_ORGS && !orgs.some((o) => o.id === value));
  const options = !scoped || showAll
    ? orgSelectOptions(orgs, { personal, unknown })
    : orgSelectOptions(orgs).map((o) => (o.value === "all" ? { value: TEAM_ORGS, label: "우리 조직 전체" } : o));
  const select = (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-8 ${className} text-xs`}><SelectValue placeholder="Claude 조직" /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  if (!scoped) return select;
  return (
    <span className="inline-flex items-center gap-2">
      {select}
      <label className="flex items-center gap-1 text-xs text-muted-foreground" title="개인 계정·계정 정보 없는 세션(SDK·headless) 등 우리 Team 조직 밖 세션까지 포함">
        <input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); onChange(e.target.checked ? "all" : TEAM_ORGS); }} />
        전체 조회
      </label>
    </span>
  );
}
