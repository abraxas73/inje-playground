"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ShieldAlert } from "lucide-react";
import { dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";
import { int } from "./format";
import type { ClaudeOrg } from "@/types/claude-usage";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "7일" }, { key: "30d", label: "30일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];

interface PromptRow {
  id: number;
  ts: string;
  org_id: string;
  user_email: string;
  session_id: string | null;
  prompt_length: number | null;
  prompt: string;
  employee_name: string | null;
  team: string | null;
  headquarters: string | null;
}
interface Resp { range: { from: string; to: string }; rows: PromptRow[]; total: number; notReady: boolean }

function fmtTs(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function PromptsTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const [preset, setPreset] = useState<RangePreset>("7d");
  const [range, setRange] = useState(() => dateRangePreset("7d"));
  const [org, setOrg] = useState("all");
  const [q, setQ] = useState("");
  const [email, setEmail] = useState("");
  const [applied, setApplied] = useState({ q: "", email: "" });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [result, setResult] = useState<{ key: string; data?: Resp; error?: string } | null>(null);
  const requestKey = `${range.from}|${range.to}|${org}|${applied.q}|${applied.email}`;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ from: range.from, to: range.to, org });
    if (applied.q) params.set("q", applied.q);
    if (applied.email) params.set("email", applied.email);
    fetch(`/api/admin/claude-usage/prompts?${params.toString()}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Resp; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [range.from, range.to, org, applied.q, applied.email, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const rows = data?.rows ?? [];
  const avgLen = useMemo(() => (rows.length ? Math.round(rows.reduce((a, r) => a + (r.prompt_length ?? r.prompt.length), 0) / rows.length) : 0), [rows]);
  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs]);

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>프롬프트 <b>내용</b>은 민감 정보입니다. 관리형 설정에 <code>OTEL_LOG_USER_PROMPTS=1</code>을 적용하고 <b>구성원에게 내용 수집을 재공지한 뒤</b>부터 수집됩니다(적용 전 발화는 수집되지 않음). 응답·코드·파일 내용은 수집하지 않습니다.</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { setPreset(p.key); setRange(dateRangePreset(p.key)); }}>{p.label}</Button>
        ))}
        <span className="text-xs text-muted-foreground">{range.from} ~ {range.to}</span>
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue placeholder="Claude 조직" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 Claude 조직</SelectItem>
            {orgs.filter((o) => o.id !== "unknown" && o.id !== "test-org").map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setApplied({ q: q.trim(), email: email.trim() }); }} placeholder="이메일 필터" className="h-8 w-[160px] text-xs" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setApplied({ q: q.trim(), email: email.trim() }); }} placeholder="내용 검색 후 Enter" className="h-8 w-[220px] text-xs" />
        <Button size="sm" variant="outline" onClick={() => setApplied({ q: q.trim(), email: email.trim() })}>검색</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.notReady && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          프롬프트 테이블이 아직 없습니다 — Supabase SQL Editor에서 <code>docs/sql/2026-08-31-claude-code-prompts.sql</code>을 실행하세요.
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            프롬프트 ({int(data?.total ?? 0)}건 중 최신 {int(rows.length)}건 표시 · 평균 {int(avgLen)}자)
          </CardTitle>
          <p className="text-xs text-muted-foreground">행을 클릭하면 전체 내용이 펼쳐집니다. 내용은 4,000자에서 잘려 저장됩니다.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-2 py-1 text-left whitespace-nowrap">시각</th>
                  <th className="px-2 py-1 text-left whitespace-nowrap">사용자</th>
                  <th className="px-2 py-1 text-left whitespace-nowrap">팀</th>
                  <th className="px-2 py-1 text-left whitespace-nowrap">조직</th>
                  <th className="px-2 py-1 text-right whitespace-nowrap">길이</th>
                  <th className="px-2 py-1 text-left w-full">내용</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-t align-top hover:bg-muted/40" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-muted-foreground">{fmtTs(r.ts)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <div className="font-medium">{r.employee_name ?? r.user_email.split("@")[0]}</div>
                      <div className="text-muted-foreground">{r.user_email}</div>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.team ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><Badge variant="outline" className="text-[10px]">{orgName.get(r.org_id) ?? r.org_id.slice(0, 8)}</Badge></td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{int(r.prompt_length ?? r.prompt.length)}</td>
                    <td className="px-2 py-1.5">
                      {expanded === r.id
                        ? <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-sans">{r.prompt}</pre>
                        : <span className="line-clamp-2 break-all text-muted-foreground">{r.prompt.slice(0, 240)}</span>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">{loading ? "불러오는 중..." : "수집된 프롬프트가 없습니다. 관리형 설정 적용·재시작 이후 발화부터 수집됩니다."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
