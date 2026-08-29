"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Upload, Trash2 } from "lucide-react";
import SortableTable, { type Column } from "./SortableTable";
import { hasSeat, isIdleSeat } from "@/lib/claude-usage/aggregate";
import { usd } from "./format";
import type { ClaudeOrg, CsvImport, MemberActivityRow } from "@/types/claude-usage";

type Row = MemberActivityRow & { org_id: string; import_id: string; team?: string | null; headquarters?: string | null; division?: string | null };
interface MembersResponse { imports: CsvImport[]; rows: Row[] }
interface UploadResult { filename: string; ok: boolean; org_id?: string; period_start?: string; period_end?: string; row_count?: number; error?: string }

/** ISO → "2026-08-27 15:44" (KST, 브라우저 로캘) */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(/\. /g, "-").replace(/\.$/, "").replace(/-(\d{2}:\d{2})/, " $1");
}

export default function MembersCsvTab({ orgs, onOrgsChange }: { orgs: ClaudeOrg[]; onOrgsChange?: () => void }) {
  const [org, setOrg] = useState("all");
  const [importId, setImportId] = useState("latest");
  const [tick, setTick] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [idleOnly, setIdleOnly] = useState(false);
  const [manualOrgId, setManualOrgId] = useState("");
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");

  const key = `${org}|${importId}|${tick}`;
  const [result, setResult] = useState<{ key: string; data?: MembersResponse; error?: string } | null>(null);
  const loading = result?.key !== key;
  const data = result?.key === key ? result.data ?? null : null;
  const error = result?.key === key ? result.error ?? null : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/claude-usage/members?org=${encodeURIComponent(org)}&importId=${encodeURIComponent(importId)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j as MembersResponse;
      })
      .then((j) => {
        if (alive) setResult({ key, data: j });
      })
      .catch((e) => {
        if (alive) setResult({ key, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, [key, org, importId, tick]);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setResults(null);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    const manualComplete = files.length === 1 && manualOrgId.trim() && manualStart.trim() && manualEnd.trim();
    if (manualComplete) {
      fd.append("orgId", manualOrgId.trim());
      fd.append("periodStart", manualStart.trim());
      fd.append("periodEnd", manualEnd.trim());
    }
    try {
      const r = await fetch("/api/admin/claude-usage/imports", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setResults(j.results as UploadResult[]);
      setImportId("latest");
      setTick((t) => t + 1);
      if (manualComplete) {
        setManualOrgId("");
        setManualStart("");
        setManualEnd("");
      }
      onOrgsChange?.();
    } catch (e) {
      setResults([{ filename: "-", ok: false, error: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    setRemoveError(null);
    const r = await fetch(`/api/admin/claude-usage/imports/${id}`, { method: "DELETE" });
    if (r.ok) {
      setImportId("latest");
      setTick((t) => t + 1);
      return;
    }
    const j = await r.json().catch(() => ({}) as { error?: string });
    setRemoveError(j.error ?? `HTTP ${r.status}`);
  };

  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs]);
  /** 조직별 최신 import 중 가장 최근 업로드 시각 — "마지막 CSV 수집" 표시용 */
  const lastCollected = useMemo(() => {
    const latest = new Map<string, { created_at: string; period_end: string }>();
    for (const i of data?.imports ?? []) {
      const prev = latest.get(i.org_id);
      if (!prev || i.created_at > prev.created_at) latest.set(i.org_id, { created_at: i.created_at, period_end: i.period_end });
    }
    if (latest.size === 0) return null;
    const vals = [...latest.values()];
    return { at: vals.map((v) => v.created_at).sort().at(-1)!, orgs: latest.size, periodEnd: vals.map((v) => v.period_end).sort().at(-1)! };
  }, [data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => (!s || r.email.includes(s) || r.name.toLowerCase().includes(s) || (r.team ?? "").toLowerCase().includes(s)) && (!idleOnly || isIdleSeat(r)));
  }, [data, q, idleOnly]);
  const idleCount = useMemo(() => (data?.rows ?? []).filter(isIdleSeat).length, [data]);

  const columns: Column<Row>[] = [
    { key: "user", header: "사용자", value: (r) => r.email, render: (r) => (<div><div className="font-medium">{r.name || r.email}</div>{r.name && <div className="text-muted-foreground">{r.email}</div>}</div>) },
    { key: "org", header: "조직", value: (r) => orgName.get(r.org_id) ?? r.org_id, render: (r) => <Badge variant="outline" className="text-[10px]">{orgName.get(r.org_id) ?? r.org_id.slice(0, 8)}</Badge> },
    { key: "team", header: "조직 / 팀", value: (r) => `${r.headquarters ?? r.division ?? ""} ${r.team ?? ""}`.trim(), render: (r) => (r.team
      ? <div title={[r.division, r.headquarters, r.team].filter(Boolean).join(" > ")}><div>{r.team}</div>{(r.headquarters ?? r.division) && (r.headquarters ?? r.division) !== r.team && <div className="text-muted-foreground">{r.headquarters ?? r.division}</div>}</div>
      : <span className="text-muted-foreground">—</span>) },
    { key: "role", header: "역할", value: (r) => r.role },
    { key: "tier", header: "시트", value: (r) => r.seat_tier, render: (r) => (hasSeat(r.seat_tier) ? r.seat_tier : <span className="text-muted-foreground">미할당</span>) },
    { key: "last", header: "마지막 활동", value: (r) => r.last_active ?? "" },
    { key: "days", header: "활동일", align: "right", value: (r) => r.days_active },
    { key: "chats", header: "채팅", align: "right", value: (r) => r.chats },
    { key: "msgs", header: "메시지", align: "right", value: (r) => r.messages },
    { key: "code", header: "코드 세션", align: "right", value: (r) => r.code_sessions },
    { key: "prs", header: "PR", align: "right", value: (r) => r.pull_requests },
    { key: "cowork", header: "Cowork 세션", align: "right", value: (r) => r.cowork_sessions },
    { key: "cwmsg", header: "Cowork 메시지", align: "right", value: (r) => r.cowork_messages },
    { key: "proj", header: "프로젝트", align: "right", value: (r) => r.projects_used },
    { key: "art", header: "아티팩트", align: "right", value: (r) => r.artifacts_created },
    { key: "spend", header: "초과 지출", align: "right", value: (r) => r.estimated_spend_usd, render: (r) => usd(r.estimated_spend_usd) },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">멤버 활동 CSV 업로드</CardTitle>
            <p className="text-sm">
              {lastCollected
                ? <>마지막 CSV 수집: <b>{fmtDateTime(lastCollected.at)}</b> <span className="text-muted-foreground">· {lastCollected.orgs}개 조직 · 데이터 기간 ~{lastCollected.periodEnd}</span></>
                : <span className="text-muted-foreground">마지막 CSV 수집: 없음</span>}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <p className="text-muted-foreground">claude.ai → 분석 → 개요 → 멤버 <b>모두 보기</b> → 기간 30일 → <b>CSV 내보내기</b>. 파일명 <code>members-analytics-&lt;조직ID&gt;-&lt;시작&gt;-to-&lt;끝&gt;.csv</code>를 그대로 올리면 조직·기간을 자동 인식합니다. 여러 조직 파일을 한 번에 선택할 수 있고, 같은 조직·기간은 교체됩니다.</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 hover:bg-muted">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            파일 선택(여러 개 가능)
            <input type="file" accept=".csv,text/csv" multiple className="hidden" disabled={uploading} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Input value={manualOrgId} onChange={(e) => setManualOrgId(e.target.value)} placeholder="조직 ID (예: 4ad6b3e9-…)" className="h-8 w-[220px] text-xs" disabled={uploading} />
            <Input value={manualStart} onChange={(e) => setManualStart(e.target.value)} placeholder="시작일 (YYYY-MM-DD)" className="h-8 w-[160px] text-xs" disabled={uploading} />
            <Input value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} placeholder="종료일 (YYYY-MM-DD)" className="h-8 w-[160px] text-xs" disabled={uploading} />
          </div>
          <p className="text-muted-foreground">파일명에서 조직/기간을 읽을 수 없을 때 파일 1개만 선택하고 입력하세요</p>
          {results && (
            <ul className="space-y-0.5">
              {results.map((r, i) => (
                <li key={i} className={r.ok ? "text-emerald-600" : "text-destructive"}>
                  {r.ok ? `✓ ${r.filename} → ${orgName.get(r.org_id!) ?? r.org_id} ${r.period_start}~${r.period_end}, ${r.row_count}명` : `✗ ${r.filename}: ${r.error}`}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={org} onValueChange={(v) => { setOrg(v); setImportId("latest"); }}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="조직" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 조직(최신 기간)</SelectItem>
            {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={importId} onValueChange={setImportId}>
          <SelectTrigger className="h-8 w-[260px] text-xs"><SelectValue placeholder="기간" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">조직별 최신 업로드</SelectItem>
            {(data?.imports ?? []).map((i) => <SelectItem key={i.id} value={i.id}>{orgName.get(i.org_id) ?? i.org_id.slice(0, 8)} · {i.period_start}~{i.period_end} ({i.row_count}명)</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일/이름 검색" className="h-8 w-[200px] text-xs" />
        <Button size="sm" variant={idleOnly ? "default" : "outline"} onClick={() => setIdleOnly((v) => !v)}>노는 시트만 ({idleCount})</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">멤버 활동 ({rows.length}명) — 노는 시트는 붉게 표시{lastCollected && <span className="ml-2 font-normal text-muted-foreground">· 데이터 ~{lastCollected.periodEnd}, 수집 {fmtDateTime(lastCollected.at)}</span>}</CardTitle></CardHeader>
        <CardContent>
          <SortableTable rows={rows} columns={columns} rowKey={(r) => `${r.import_id}:${r.email}`} defaultSort={{ key: "chats", dir: "desc" }} rowClassName={(r) => (isIdleSeat(r) ? "bg-destructive/5" : "")} emptyText={loading ? "불러오는 중..." : "업로드된 CSV가 없습니다."} />
        </CardContent>
      </Card>

      {(data?.imports.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">업로드 이력</CardTitle>
            {lastCollected && <p className="text-xs text-muted-foreground">마지막 CSV 수집: {fmtDateTime(lastCollected.at)} · {lastCollected.orgs}개 조직(조직별 최신 기준)</p>}
          </CardHeader>
          <CardContent>
            {removeError && <p className="mb-2 text-xs text-destructive">{removeError}</p>}
            <ul className="space-y-1 text-xs">
              {(data?.imports ?? []).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 border-b py-1 last:border-0">
                  <span>{orgName.get(i.org_id) ?? i.org_id.slice(0, 8)} · {i.period_start} ~ {i.period_end} · {i.row_count}명 · 수집 {fmtDateTime(i.created_at)} · <span className="text-muted-foreground">{i.filename}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => remove(i.id)} aria-label="삭제"><Trash2 className="h-3.5 w-3.5" /></Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
