"use client";

import { useMemo } from "react";
import SearchableSelect, { type SearchableOption } from "@/components/shared/SearchableSelect";

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

/** 검색(전치·부분 일치)되는 조직/팀 콤보박스. 옵션은 현재 표에 있는 소속으로 만든다 */
export default function UnitFilter({ value, onChange, rows, className }: { value: string; onChange: (v: string) => void; rows: UnitLike[]; className?: string }) {
  const options = useMemo<SearchableOption[]>(() => {
    const hqs = new Set<string>();
    const teams = new Set<string>();
    let missing = 0;
    for (const r of rows) {
      const u = unitOf(r);
      if (u) hqs.add(u);
      if (r.team) teams.add(r.team);
      else missing++;
    }
    return [
      { value: "all", label: "전체 조직/팀 (사내)" },
      { value: "none", label: "명부 없음", hint: String(missing) },
      ...[...hqs].sort().map((h) => ({ value: `hq:${h}`, label: h, group: "본부 / 부문" })),
      ...[...teams].sort().map((t) => ({ value: `team:${t}`, label: t, group: "팀 / 센터" })),
    ];
  }, [rows]);

  return <SearchableSelect value={value} onChange={onChange} options={options} placeholder="조직/팀" searchPlaceholder="조직/팀 검색" className={className ?? "w-[220px]"} />;
}
