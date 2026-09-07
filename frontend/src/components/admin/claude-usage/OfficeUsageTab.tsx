"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import UnitFilter, { matchUnit } from "@/components/admin/claude-usage/UnitFilter";
import { Download, Loader2 } from "lucide-react";
import OfficeUsagePanel, { type OfficeData, type OfficeUserView } from "./OfficeUsagePanel";
import { dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";
import { surfacesText } from "@/lib/claude-usage/office-usage";
import { downloadCsv } from "@/lib/claude-usage/csv-download";
import type { ClaudeOrg } from "@/types/claude-usage";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "7일" }, { key: "30d", label: "30일" }, { key: "90d", label: "90일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];

type Resp = OfficeData & { range: { from: string; to: string } };

/**
 * Claude for M365(Excel·Word·PowerPoint·Outlook) 추가 기능 사용량 탭 — 조직 설정의 커스텀 OTel 수집기로 받은 스팬 기준.
 * 수집기를 등록한 Claude 조직만 잡힌다(2026-09-04 Innogrid-ax부터).
 */
export default function OfficeUsageTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [range, setRange] = useState(() => dateRangePreset("30d"));
  const [org, setOrg] = useState("all");
  const [unit, setUnit] = useState("all");
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ key: string; data?: Resp; error?: string } | null>(null);
  const requestKey = `${range.from}|${range.to}|${org}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/claude-usage/office?from=${range.from}&to=${range.to}&org=${encodeURIComponent(org)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Resp; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [range.from, range.to, org, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.key === requestKey ? result.data ?? null : null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const orgName = useMemo(() => { const m = new Map(orgs.map((o) => [o.id, o.name])); return (id: string) => m.get(id) ?? id.slice(0, 8); }, [orgs]);
  const users = useMemo<OfficeUserView[]>(() => {
    const s = q.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => matchUnit(u, unit) && (!s || u.user_email.includes(s) || (u.employee_name ?? "").toLowerCase().includes(s) || (u.team ?? "").toLowerCase().includes(s)));
  }, [data, unit, q]);

  const exportCsv = () => {
    const head = ["email", "name", "team", "parent_unit", "orgs", "surfaces", "turns", "sessions", "active_days", "model_calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "tool_calls", "tool_errors", "file_uploads"];
    downloadCsv(`claude-office-usage-${range.from}-to-${range.to}.csv`, head, users.map((u) => [u.user_email, u.employee_name ?? "", u.team ?? "", u.parent_unit ?? "", u.orgs.map(orgName).join("|"), surfacesText(u.surfaces), u.turns, u.sessions, u.active_days, u.model_calls, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_creation_tokens, u.tool_calls, u.tool_errors, u.file_uploads]));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { setPreset(p.key); setRange(dateRangePreset(p.key)); }}>{p.label}</Button>
        ))}
        <span className="text-xs text-muted-foreground">{range.from} ~ {range.to}</span>
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Claude 조직" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 Claude 조직</SelectItem>
            {orgs.filter((o) => o.id !== "unknown" && o.id !== "test-org").map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <UnitFilter value={unit} onChange={setUnit} rows={data?.users ?? []} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일/이름 검색" className="h-8 w-[200px] text-xs" />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={users.length === 0}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.notReady && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          집계 함수가 아직 없습니다 — Supabase SQL Editor에서 <code>docs/sql/2026-09-07-claude-office-daily.sql</code>을 실행하세요.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Excel·Word·PowerPoint·Outlook 추가 기능(Claude Office Agents) 사용량 — claude.ai 관리자 설정 &gt; 제품 &gt; Office Agents &gt; 모니터링에 등록한 OTLP 수집기로 받습니다(Innogrid-ax 2026-09-04, 나머지 6개 조직 2026-09-07 등록). 등록 뒤 추가 기능을 다시 연 시점부터 잡힙니다. 원본 스팬의 프롬프트·도구 입출력·문서 URL은 서버가 읽지 않고 버립니다.
      </p>

      <OfficeUsagePanel data={data} users={users} showUnit showOrgs orgName={orgName} loading={loading} />
    </div>
  );
}
