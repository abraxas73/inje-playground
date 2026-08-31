"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, RefreshCw } from "lucide-react";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import type { DirectoryPerson, DirectoryResponse } from "@/types/directory";

/** ISO → "2026-08-29 12:34" */
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(/\. /g, "-").replace(/\.$/, "").replace(/-(\d{2}:\d{2})/, " $1");
}

const ALL = "__all__";

/** 조직장 자동 판정(직책) — lib/usage-scope.ts의 LEADER_DUTY_RE와 동일하게 유지 */
const LEADER_DUTY_RE = /(팀장|센터장|실장|소장|본부장|부문장|그룹장|연구소장|대표)/;

export default function DirectoryTable() {
  // 파생 로딩 패턴: 요청 키와 결과 키를 비교해 loading을 계산한다(effect 본문에서 setState 호출 금지 규칙 준수)
  const [result, setResult] = useState<{ key: string; data?: DirectoryResponse; error?: string } | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [q, setQ] = useState("");
  const [division, setDivision] = useState(ALL);
  const [headquarters, setHeadquarters] = useState(ALL);
  const [reloadKey, setReloadKey] = useState(0);
  const [leaderOverride, setLeaderOverride] = useState<Record<string, boolean>>({});
  const [leaderError, setLeaderError] = useState<string | null>(null);

  const requestKey = `${includeInactive ? "all" : "true"}|${reloadKey}`;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/directory?active=${includeInactive ? "all" : "true"}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j as DirectoryResponse;
      })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [includeInactive, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null; // 재조회 중엔 이전 결과를 유지해 표가 깜빡이지 않게 한다
  const error = result?.key === requestKey ? result.error ?? null : null;

  const divisions = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.division).filter((v): v is string => !!v))].sort(), [data]);
  const headquartersList = useMemo(
    () => [...new Set((data?.rows ?? []).filter((r) => division === ALL || r.division === division).map((r) => r.headquarters).filter((v): v is string => !!v))].sort(),
    [data, division]
  );

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) =>
      (division === ALL || r.division === division) &&
      (headquarters === ALL || r.headquarters === headquarters) &&
      (!s || [r.name, r.email, r.login_id, r.team, r.headquarters, r.division, r.duty, r.position].some((v) => (v ?? "").toLowerCase().includes(s)))
    );
  }, [data, q, division, headquarters]);

  const teamCount = useMemo(() => new Set(rows.map((r) => r.team ?? "")).size, [rows]);

  /** 실효 조직장 = 지역 오버라이드 → is_leader(명시) → 직책 자동 판정 */
  const isLeader = (r: DirectoryPerson): boolean =>
    r.email in leaderOverride ? leaderOverride[r.email] : r.is_leader ?? LEADER_DUTY_RE.test(r.duty ?? "");

  const toggleLeader = async (r: DirectoryPerson) => {
    const next = !isLeader(r);
    setLeaderError(null);
    setLeaderOverride((m) => ({ ...m, [r.email]: next }));
    const res = await fetch("/api/admin/directory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: r.email, is_leader: next }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}) as { error?: string });
      setLeaderError(j.error ?? `HTTP ${res.status}`);
      setLeaderOverride((m) => { const { [r.email]: _drop, ...rest } = m; return rest; });
    }
  };

  const columns: Column<DirectoryPerson>[] = [
    { key: "name", header: "이름", value: (r) => r.name, render: (r) => (<div><div className="font-medium">{r.name}</div><div className="text-muted-foreground">{r.email}</div></div>) },
    { key: "division", header: "부문", value: (r) => r.division ?? "", render: (r) => r.division ?? <span className="text-muted-foreground">—</span> },
    { key: "hq", header: "본부", value: (r) => r.headquarters ?? "", render: (r) => r.headquarters ?? <span className="text-muted-foreground">—</span> },
    { key: "team", header: "센터/팀", value: (r) => r.team ?? "", render: (r) => (
      <span title={r.dept_path ?? undefined}>{r.team ?? <span className="text-muted-foreground">—</span>}</span>) },
    { key: "duty", header: "직책", value: (r) => r.duty ?? "" },
    { key: "leader", header: "조직장", value: (r) => (isLeader(r) ? 1 : 0), render: (r) => (
      <input
        type="checkbox"
        className="h-3.5 w-3.5 cursor-pointer accent-primary"
        checked={isLeader(r)}
        onChange={() => toggleLeader(r)}
        onClick={(e) => e.stopPropagation()}
        title={r.is_leader == null && !(r.email in leaderOverride) ? "직책으로 자동 판정됨 — 클릭해 직접 지정" : "관리자 지정"}
        aria-label={`${r.name} 조직장 여부`}
      />) },
    { key: "position", header: "직급", value: (r) => r.position ?? "" },
    { key: "active", header: "상태", value: (r) => (r.active ? "재직" : "비활성"), render: (r) => (r.active ? <Badge variant="outline" className="text-[10px]">재직</Badge> : <Badge variant="destructive" className="text-[10px]">비활성</Badge>) },
    { key: "synced", header: "동기화", value: (r) => r.synced_at, render: (r) => <span className="text-muted-foreground">{fmtDateTime(r.synced_at)}</span> },
  ];

  const exportCsv = () => {
    const head = ["name", "email", "login_id", "division", "headquarters", "team", "duty", "position", "active", "dept_path", "synced_at"];
    const lines = rows.map((r) => [r.name, r.email, r.login_id ?? "", r.division ?? "", r.headquarters ?? "", r.team ?? "", r.duty ?? "", r.position ?? "", r.active ? "Y" : "N", r.dept_path ?? "", r.synced_at]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `company-directory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sync = data?.lastSync;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              동기화 상태
              <Button size="sm" variant="ghost" onClick={() => setReloadKey((k) => k + 1)} aria-label="새로고침"><RefreshCw className="h-3.5 w-3.5" /></Button>
            </CardTitle>
            <p className="text-sm">
              {sync
                ? <>마지막 동기화: <b>{fmtDateTime(sync.synced_at)}</b> <span className="text-muted-foreground">· {sync.total}명 · 비활성 처리 {sync.deactivated}명 · 출처 {sync.source}{sync.query ? `(${sync.query})` : ""}</span></>
                : loading && !data
                  ? <span className="text-muted-foreground">불러오는 중...</span>
                  : <span className="text-muted-foreground">아직 동기화된 명부가 없습니다.</span>}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <p>출처: 그룹웨어 <b>아마란스</b>(gw.innogrid.com) 조직도 — inno-creed MCP <code>find_person</code> 전사 명부. Claude 조직(Team 플랜)과는 별개의 회사 소속 정보입니다.</p>
          <p>갱신: 이 PC(inno-creed 로그인 가능)에서 <code>./frontend/scripts/company-directory-sync.py</code> 실행 → 이메일 기준 upsert, 이번 명부에 없는 사람은 <b>비활성</b>으로 표시(삭제하지 않음). 런북: <code>docs/company-directory.md</code></p>
          {data && <p>재직 {data.counts.active}명 · 비활성 {data.counts.inactive}명</p>}
          <p><b>조직장</b> 체크 = 개인 메뉴(Claude Code·채팅·성과)에서 자기 말단 조직(팀/센터/본부) 구성원까지 조회 가능. 체크 안 하면 본인만. 기본값은 직책(팀장·센터장·본부장 등) 자동 판정이며, 클릭하면 직접 지정으로 바뀝니다.</p>
          {error && <p className="text-destructive">{error}</p>}
          {leaderError && <p className="text-destructive">조직장 변경 실패: {leaderError}</p>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={division} onValueChange={(v) => { setDivision(v); setHeadquarters(ALL); }}>
          <SelectTrigger className="w-56"><SelectValue placeholder="부문" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 부문</SelectItem>
            {divisions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={headquarters} onValueChange={setHeadquarters}>
          <SelectTrigger className="w-56"><SelectValue placeholder="본부" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 본부</SelectItem>
            {headquartersList.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="w-64" placeholder="이름/이메일/팀/직책 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" variant={includeInactive ? "default" : "outline"} onClick={() => setIncludeInactive((v) => !v)}>비활성 포함</Button>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            구성원 ({rows.length}명 · 팀/센터 {teamCount}개)
            {sync && <span className="ml-2 font-normal text-muted-foreground">· 기준 {fmtDateTime(sync.synced_at)}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SortableTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.email}
            defaultSort={{ key: "division", dir: "asc" }}
            rowClassName={(r) => (r.active ? "" : "opacity-60")}
            emptyText={loading ? "불러오는 중..." : "명부가 없습니다. 동기화 스크립트를 실행하세요."}
          />
        </CardContent>
      </Card>
    </div>
  );
}
