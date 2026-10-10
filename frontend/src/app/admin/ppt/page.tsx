"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Presentation, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DeckList from "@/components/ppt/DeckList";
import { STATUS_LABEL } from "@/components/ppt/StatusBadge";
import { formatUsd } from "@/lib/ppt/pricing";
import type { PptAdminDecksResponse, PptVersionStatus } from "@/types/ppt";

const ALL = "__all";

export default function AdminPptPage() {
  const [decks, setDecks] = useState<PptAdminDecksResponse["decks"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ppt/decks");
      const json = (await res.json()) as Partial<PptAdminDecksResponse> & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDecks(json.decks ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "덱 목록을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const ownerOf = (d: PptAdminDecksResponse["decks"][number]) => d.ownerLabel ?? d.ownerEmail;
  const owners = useMemo(() => [...new Set((decks ?? []).map(ownerOf))].sort((a, b) => a.localeCompare(b, "ko")), [decks]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (decks ?? []).filter((d) =>
      (owner === ALL || ownerOf(d) === owner) &&
      (status === ALL || d.latest?.status === status) &&
      (!term || d.title.toLowerCase().includes(term) || ownerOf(d).toLowerCase().includes(term) || d.ownerEmail.toLowerCase().includes(term)));
  }, [decks, q, owner, status]);
  const stats = useMemo(() => ({
    decks: shown.length,
    users: new Set(shown.map((d) => d.ownerEmail)).size,
    versions: shown.reduce((a, d) => a + d.versionCount, 0),
    cost: shown.reduce((a, d) => a + (d.costUsd ?? 0), 0),
  }), [shown]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Presentation className="h-5 w-5 text-sky-600" />
        <h1 className="text-lg font-semibold">PPT 덱 관리</h1>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}><RefreshCw className="mr-1 h-4 w-4" />새로고침</Button>
      </div>
      <p className="text-sm text-muted-foreground">PPT 만들기로 만든 모든 사용자의 덱입니다. 제목을 누르면 버전·다운로드·공유를 관리하고, 휴지통으로 삭제합니다(모든 버전·파일 함께, 되돌릴 수 없음).</p>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["덱", stats.decks.toLocaleString()], ["사용자", stats.users.toLocaleString()], ["버전", stats.versions.toLocaleString()], ["LLM 추정 비용", formatUsd(stats.cost)]].map(([label, value]) => (
          <Card key={label}><CardContent className="py-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-semibold tabular-nums">{value}</div></CardContent></Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-64" placeholder="제목·소유자 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>모든 소유자</SelectItem>{owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>모든 상태</SelectItem>{(Object.keys(STATUS_LABEL) as PptVersionStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {decks && <DeckList decks={shown} showOwner onDeleted={() => void load()} onError={setError} />}
    </div>
  );
}
