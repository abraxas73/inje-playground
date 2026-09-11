"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, Newspaper, RefreshCw, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PeopleNewsResponse } from "@/types/people-news";
import SubscriptionCard from "@/components/people-news/SubscriptionCard";

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
const INITIAL_FILTERS = { category: "all", q: "", from: "", to: "", page: 1 };

export default function PeopleNewsPage() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [data, setData] = useState<PeopleNewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function syncNow() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const response = await fetch("/api/people-news/sync", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "지금 가져오기에 실패했습니다.");
      setSyncMessage({ text: `${result.count}건을 확인하고 목록을 업데이트했습니다.`, error: false });
      changeFilters({ page: 1 });
    } catch (e) {
      setSyncMessage({ text: e instanceof Error ? e.message : "지금 가져오기에 실패했습니다.", error: true });
    } finally {
      setSyncing(false);
      setRevision((n) => n + 1);
    }
  }

  function changeFilters(next: Partial<typeof INITIAL_FILTERS>) {
    setLoading(true);
    setFilters((old) => ({ ...old, ...next, page: next.page ?? 1 }));
  }

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ ...filters, page: String(filters.page) });
        const response = await fetch(`/api/people-news?${params}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "인사·부고를 불러오지 못했습니다.");
        if (!controller.signal.aborted) setData(result as PeopleNewsResponse);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "인사·부고를 불러오지 못했습니다.");
          setData(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filters, revision]);

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)));
  const filtered = !!(filters.q || filters.from || filters.to || filters.category !== "all");
  const syncFailed = data?.latestSync?.status === "failed";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Newspaper className="h-7 w-7 shrink-0 text-sky-600" />
          <div>
            <h1 className="text-2xl font-bold">인사·부고</h1>
            <p className="text-sm text-muted-foreground">연합뉴스에서 전하는 인사와 부고 소식을 확인하세요.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={loading || syncing} onClick={() => { setLoading(true); setRevision((n) => n + 1); }}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />목록 새로고침
          </Button>
          <Button size="sm" disabled={syncing} onClick={syncNow}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {syncing ? "가져오는 중…" : "지금 가져오기"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />매일 오전 7시 업데이트 · 한국 시간</span>
        {data?.lastSyncedAt && <span>마지막 수집 {dateTime.format(new Date(data.lastSyncedAt))}</span>}
        <a href="https://www.yna.co.kr/people/all" target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
          출처: 연합뉴스<ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {syncFailed && <Alert><AlertDescription>최근 자동 수집에 실패하여 이전에 수집한 소식을 표시합니다. 원문에서 최신 내용을 확인할 수 있습니다.</AlertDescription></Alert>}
      {syncMessage && <Alert variant={syncMessage.error ? "destructive" : "default"}><AlertDescription role="status">{syncMessage.text}</AlertDescription></Alert>}

      <SubscriptionCard />

      <Card>
        <CardContent className="space-y-4 pt-5">
          <Tabs value={filters.category} onValueChange={(category) => changeFilters({ category })}>
            <TabsList aria-label="소식 구분">
              <TabsTrigger value="all">전체</TabsTrigger>
              <TabsTrigger value="personnel">인사</TabsTrigger>
              <TabsTrigger value="obituary">부고</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="notice-search">제목 검색</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="notice-search" className="pl-9" placeholder="이름 또는 기관명" value={filters.q} maxLength={100} onChange={(e) => changeFilters({ q: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notice-from">시작일</Label>
              <Input id="notice-from" type="date" className="w-40" value={filters.from} max={filters.to || undefined} onChange={(e) => changeFilters({ from: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notice-to">종료일</Label>
              <Input id="notice-to" type="date" className="w-40" value={filters.to} min={filters.from || undefined} onChange={(e) => changeFilters({ to: e.target.value })} />
            </div>
            {filtered && <Button variant="ghost" onClick={() => changeFilters(INITIAL_FILTERS)}>초기화</Button>}
          </div>
        </CardContent>
      </Card>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <section aria-label="인사·부고 목록" aria-busy={loading}>
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />소식을 불러오는 중입니다.</div>
        ) : data && data.notices.length ? (
          <>
            <p className="mb-3 text-sm text-muted-foreground" role="status">총 {data.total.toLocaleString()}건 · 최신순</p>
            <ul className="divide-y rounded-xl border bg-card">
              {data.notices.map((notice) => (
                <li key={notice.source_id}>
                  <a href={notice.source_url} target="_blank" rel="noopener noreferrer" className="group block rounded-xl p-4 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary sm:p-5">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant={notice.category === "personnel" ? "secondary" : "outline"}>{notice.category === "personnel" ? "인사" : "부고"}</Badge>
                      <time dateTime={notice.published_at} className="text-xs text-muted-foreground">{dateTime.format(new Date(notice.published_at))}</time>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-semibold leading-relaxed group-hover:text-primary">{notice.title}</h2>
                      <span className="mt-1 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">원문<ExternalLink className="h-3.5 w-3.5" /><span className="sr-only"> 새 창</span></span>
                    </div>
                    {notice.summary && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{notice.summary}</p>}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>{data.page} / {pageCount} 페이지</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => changeFilters({ page: data.page - 1 })}><ChevronLeft className="h-4 w-4" />이전</Button>
                <Button variant="outline" size="sm" disabled={data.page >= pageCount} onClick={() => changeFilters({ page: data.page + 1 })}>다음<ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </>
        ) : data ? (
          <div className="rounded-xl border border-dashed px-5 py-16 text-center">
            <Newspaper className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="font-medium">{filtered ? "조건에 맞는 소식이 없습니다." : "아직 수집된 소식이 없습니다."}</p>
            <p className="mt-1 text-sm text-muted-foreground">{filtered ? "검색어나 날짜 범위를 변경해 보세요." : "매일 오전 7시에 연합뉴스 인사·부고를 가져옵니다."}</p>
          </div>
        ) : null}
      </section>
      <p className="text-xs leading-relaxed text-muted-foreground">연합뉴스 RSS에서 제공하는 제목과 요약입니다. 자세한 내용과 정정 사항은 원문에서 확인해 주세요.</p>
    </div>
  );
}
