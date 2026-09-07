"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Download, Loader2, RotateCcw, ScrollText, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { AUDIT_CATEGORY_LABEL, AUDIT_KIND_LABEL } from "@/lib/audit";
import { AUDIT_PAGE_SIZE_DEFAULT } from "@/lib/audit-query";
import type { AuditResponse, AuditRow } from "@/types/audit";

const KIND_CLASS: Record<AuditRow["kind"], string> = {
  login: "bg-emerald-100 text-emerald-900",
  login_failed: "bg-rose-100 text-rose-900",
  login_attempt: "bg-amber-100 text-amber-900",
  action: "bg-indigo-100 text-indigo-900",
  api: "bg-slate-100 text-slate-700",
};

const KST = "ko-KR";

function formatAt(iso: string): string {
  return new Date(iso).toLocaleString(KST, { timeZone: "Asia/Seoul", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** UA는 길어서 브라우저·OS만 짧게 */
function shortUa(ua: string | null): string {
  if (!ua) return "";
  const browser = /Edg\/|Edge\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : ua.split("/")[0];
  const os = /Macintosh|Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ");
}

function detailText(detail: Record<string, unknown>): string {
  const entries = Object.entries(detail).filter(([k]) => k !== "method" && k !== "path");
  if (!entries.length) return "";
  return entries.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ");
}

/** 오늘부터 N일 전 KST 날짜(YYYY-MM-DD) */
function kstDay(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export default function AdminAuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState("all");
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(kstDay(-29));
  const [to, setTo] = useState(kstDay());
  const [page, setPage] = useState(1);
  const pageSize = AUDIT_PAGE_SIZE_DEFAULT;

  const params = useMemo(() => {
    const p = new URLSearchParams({ kind, page: String(page), pageSize: String(pageSize) });
    if (category !== "all") p.set("category", category);
    if (search.trim()) p.set("q", search.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p;
  }, [kind, category, search, from, to, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/audit?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "조회에 실패했습니다.");
      setData(json as AuditResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const applySearch = () => {
    setPage(1);
    setSearch(q);
  };
  const reset = () => {
    setKind("all");
    setCategory("all");
    setQ("");
    setSearch("");
    setFrom(kstDay(-29));
    setTo(kstDay());
    setPage(1);
  };

  /** 현재 화면의 행을 CSV로(감사 자료 제출용) */
  const downloadCsv = () => {
    const rows = data?.rows ?? [];
    if (!rows.length) return;
    const head = ["시각(KST)", "구분", "사용자", "이메일", "카테고리", "액션", "상세", "IP", "User-Agent"];
    const body = rows.map((r) => [
      formatAt(r.at), AUDIT_KIND_LABEL[r.kind] ?? r.kind, r.userName ?? (r.userEmail ? "" : "비로그인"), r.userEmail ?? "",
      AUDIT_CATEGORY_LABEL[r.category] ?? r.category, r.action, detailText(r.detail), r.ipAddress ?? "", r.userAgent ?? "",
    ]);
    const csv = [head, ...body].map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${from}_${to}-p${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4 text-muted-foreground" />
            Audit 로그
            {data && <span className="text-xs font-normal text-muted-foreground">{data.total.toLocaleString()}건</span>}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={reset}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />초기화
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={downloadCsv} disabled={!data?.rows.length}>
              <Download className="mr-1 h-3.5 w-3.5" />이 페이지 CSV
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          로그인(성공·실패·시도)과 액션 이력을 함께 봅니다. “API 호출”은 변경 요청(POST·PUT·PATCH·DELETE)을 서버가 자동으로 남긴 것이고,
          “액션”은 화면·서버가 뜻을 붙여 남긴 것입니다. 로그인 실패는 사유(공급자 거절·코드 만료 등)가 상세에 남습니다.
          익명 설문 응답은 익명성 보장을 위해 기록하지 않습니다.
        </p>
      </CardHeader>
      <CardContent>
        {/* 필터 */}
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">구분</label>
            <Select value={kind} onValueChange={(v) => { setKind(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="login">로그인 성공</SelectItem>
                <SelectItem value="login_failed">로그인 실패</SelectItem>
                <SelectItem value="login_attempt">로그인 시도</SelectItem>
                <SelectItem value="action">액션</SelectItem>
                <SelectItem value="api">API 호출</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">카테고리</label>
            <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {(data?.categories ?? []).map((c) => (
                  <SelectItem key={c} value={c}>{AUDIT_CATEGORY_LABEL[c] ?? c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">기간(KST)</label>
            <div className="flex items-center gap-1">
              <Input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-8 w-36 text-xs" />
              <span className="text-xs text-muted-foreground">~</span>
              <Input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-8 w-36 text-xs" />
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">검색(사용자·액션·IP·상세)</label>
            <div className="flex items-center gap-1">
              <Input
                value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applySearch()}
                placeholder="이메일·이름·액션·경로·IP·상세 내용" className="h-8 min-w-[12rem] text-xs"
              />
              <Button size="sm" className="h-8 text-xs" onClick={applySearch}>
                <Search className="mr-1 h-3.5 w-3.5" />검색
              </Button>
            </div>
          </div>
        </div>

        {error && <div className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />불러오는 중…
          </div>
        ) : !data?.rows.length ? (
          <div className="py-12 text-center text-sm text-muted-foreground">조건에 맞는 기록이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">시각</th>
                  <th className="px-2 py-2 font-medium">구분</th>
                  <th className="px-2 py-2 font-medium">사용자</th>
                  <th className="px-2 py-2 font-medium">카테고리</th>
                  <th className="px-2 py-2 font-medium">액션</th>
                  <th className="px-2 py-2 font-medium">IP · 브라우저</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-b last:border-0 align-top">
                    <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-muted-foreground">{formatAt(r.at)}</td>
                    <td className="px-2 py-2">
                      <Badge variant="outline" className={cn("border-transparent text-[11px]", KIND_CLASS[r.kind])}>{AUDIT_KIND_LABEL[r.kind] ?? r.kind}</Badge>
                    </td>
                    <td className="px-2 py-2">
                      {/* 로그인 전 이벤트는 행위자가 없다 — "이름 없음"이 아니라 비로그인임을 밝힌다 */}
                      {r.userName || r.userEmail ? (
                        <>
                          <div className="text-xs font-medium">{r.userName ?? "(이름 미확인)"}</div>
                          <div className="break-all text-[11px] text-muted-foreground">{r.userEmail ?? "-"}</div>
                        </>
                      ) : (
                        <div className="text-xs italic text-muted-foreground">비로그인</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">{AUDIT_CATEGORY_LABEL[r.category] ?? r.category}</td>
                    <td className="px-2 py-2">
                      <div className="break-all text-xs">{r.action}</div>
                      {detailText(r.detail) && <div className="break-all text-[11px] text-muted-foreground">{detailText(r.detail)}</div>}
                    </td>
                    <td className="px-2 py-2 text-[11px] text-muted-foreground">
                      <div className="tabular-nums">{r.ipAddress ?? "-"}</div>
                      <div title={r.userAgent ?? undefined}>{shortUa(r.userAgent)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 페이징 */}
        {data && data.total > pageSize && (
          <div className="mt-4 flex items-center justify-between border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {data.total.toLocaleString()}건 중 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="px-2 text-xs tabular-nums">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
