"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Newspaper, Plus, RefreshCw, Search, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUserRole } from "@/hooks/useUserRole";
import type { MediaDirectoryResponse, MediaOutlet } from "@/types/media-directory";
import OutletEditor from "./OutletEditor";
import ImportDialog from "./ImportDialog";
import DeliveryHistory from "./DeliveryHistory";

export default function MediaDirectory() {
  const { isAdmin } = useUserRole();
  const [q, setQ] = useState("");
  const [data, setData] = useState<MediaDirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MediaOutlet | null | "new">(null);
  const [importOpen, setImportOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const response = await fetch(`/api/media-directory?${new URLSearchParams({ q })}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "매체·부서 목록을 불러오지 못했습니다.");
        if (!controller.signal.aborted) setData(result as MediaDirectoryResponse);
      } catch (e) {
        if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "매체·부서 목록을 불러오지 못했습니다."); setData(null); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, revision]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Newspaper className="h-7 w-7 shrink-0 text-sky-600" />
          <div>
            <h1 className="text-2xl font-bold">관리 매체·부서</h1>
            <p className="text-sm text-muted-foreground">부고 알림 매칭에 쓰는 매체·부서 목록입니다. 매체와 등록 부서가 함께 나올 때만 알림을 보내며, ‘부서 무관’ 매체는 매체만으로 일치합니다.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm"><Link href="/people-news"><ArrowLeft className="h-4 w-4" />인사·부고</Link></Button>
          <Button variant="outline" size="sm" disabled={loading} onClick={reload}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />새로고침</Button>
          {isAdmin && <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" />엑셀 업로드</Button>}
          {isAdmin && <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />매체 추가</Button>}
        </div>
      </div>
      <Card><CardContent className="flex flex-wrap items-end gap-3 pt-5">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="media-search">매체·부서·별칭 검색</Label>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="media-search" className="pl-9" value={q} maxLength={100} placeholder="예: 조선일보, 테크부" onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {data && <p className="text-sm text-muted-foreground" role="status">매체 {data.totals.outlets} · 부서 {data.totals.departments}{data.totals.activeOutlets !== data.totals.outlets && ` · 비활성 매체 ${data.totals.outlets - data.totals.activeOutlets}`}</p>}
      </CardContent></Card>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <section aria-label="매체·부서 목록" aria-busy={loading}>
        {loading && !data ? <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />목록을 불러오는 중입니다.</div> : data && data.outlets.length ? (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">매체</th><th className="px-4 py-2 font-medium">부서</th>{isAdmin && <th className="px-4 py-2" />}</tr></thead>
              <tbody className="divide-y">
                {data.outlets.map((outlet) => (
                  <tr key={outlet.id} className={outlet.active ? undefined : "text-muted-foreground"}>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{outlet.name}</span>{outlet.any_department && <Badge variant="secondary">부서 무관</Badge>}{!outlet.active && <Badge variant="outline">비활성</Badge>}</div>
                      {outlet.aliases.length > 0 && <div className="mt-1 text-xs text-muted-foreground">별칭: {outlet.aliases.join(", ")}</div>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {outlet.departments.length ? <div className="flex flex-wrap gap-1.5">{outlet.departments.map((d) => <Badge key={d.id} variant="outline" className={d.active ? undefined : "line-through opacity-60"}>{d.name}</Badge>)}</div> : <span className="text-xs text-muted-foreground">{outlet.any_department ? "매체명만으로 일치" : "등록된 부서 없음 → 알림 없음"}</span>}
                    </td>
                    {isAdmin && <td className="px-4 py-3 text-right align-top"><Button size="sm" variant="outline" onClick={() => setEditing(outlet)}>수정</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : data ? <div className="rounded-xl border border-dashed px-5 py-16 text-center text-sm text-muted-foreground">{q ? "조건에 맞는 매체·부서가 없습니다." : "등록된 매체·부서가 없습니다. 관리자가 엑셀을 업로드하면 목록이 채워집니다."}</div> : null}
      </section>
      {isAdmin && <DeliveryHistory />}
      {editing !== null && <OutletEditor outlet={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {isAdmin && <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={reload} />}
    </div>
  );
}
