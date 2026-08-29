"use client";

import { useMemo } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

/** 사내 조직도 소속 필터 — Claude 조직 필터와 별개. 값: all | none | hq:<본부/부문> | team:<팀/센터> */
export interface UnitLike {
  team?: string | null;
  headquarters?: string | null;
  division?: string | null;
}

/** 상위 단위 = 본부, 본부가 없으면 부문(대표이사 직속 등) */
export function unitOf(r: UnitLike): string | null {
  return r.headquarters ?? r.division ?? null;
}

export function matchUnit(r: UnitLike, sel: string): boolean {
  if (!sel || sel === "all") return true;
  if (sel === "none") return !r.team;
  if (sel.startsWith("hq:")) return unitOf(r) === sel.slice(3);
  if (sel.startsWith("team:")) return (r.team ?? null) === sel.slice(5);
  return true;
}

export default function UnitFilter({ value, onChange, rows, className }: { value: string; onChange: (v: string) => void; rows: UnitLike[]; className?: string }) {
  const { hqs, teams, missing } = useMemo(() => {
    const hqs = new Set<string>();
    const teams = new Set<string>();
    let missing = 0;
    for (const r of rows) {
      const u = unitOf(r);
      if (u) hqs.add(u);
      if (r.team) teams.add(r.team);
      else missing++;
    }
    return { hqs: [...hqs].sort(), teams: [...teams].sort(), missing };
  }, [rows]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "h-8 w-[220px] text-xs"}><SelectValue placeholder="조직/팀" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">전체 조직/팀 (사내)</SelectItem>
        <SelectItem value="none">명부 없음 ({missing})</SelectItem>
        {hqs.length > 0 && (
          <SelectGroup>
            <SelectLabel>본부 / 부문</SelectLabel>
            {hqs.map((h) => <SelectItem key={`hq:${h}`} value={`hq:${h}`}>{h}</SelectItem>)}
          </SelectGroup>
        )}
        {teams.length > 0 && (
          <SelectGroup>
            <SelectLabel>팀 / 센터</SelectLabel>
            {teams.map((t) => <SelectItem key={`team:${t}`} value={`team:${t}`}>{t}</SelectItem>)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
