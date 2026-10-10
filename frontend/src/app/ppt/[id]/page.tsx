"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import StatusBadge from "@/components/ppt/StatusBadge";
import ElapsedSince from "@/components/ppt/ElapsedSince";
import Storyboard from "@/components/ppt/Storyboard";
import VersionPanel from "@/components/ppt/VersionPanel";
import FeedbackBox from "@/components/ppt/FeedbackBox";
import ShareTeamsSharePoint from "@/components/ppt/ShareTeamsSharePoint";
import { postJson, readError } from "@/lib/ppt/client";
import { storyboard } from "@/lib/ppt/storyboard";
import type { PptDeckDetail, PptStatusResponse } from "@/types/ppt";

const POLL_MS = 3000;
const STUCK_MS = 14 * 60 * 1000;

export default function PptDeckPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<PptDeckDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stuckRef = useRef(false);

  const load = useCallback(async (opts?: { selectLatest?: boolean }) => {
    const res = await fetch(`/api/ppt/decks/${id}`);
    if (!res.ok) { setError(await readError(res, "덱을 불러오지 못했습니다.")); return; }
    const d = (await res.json()) as PptDeckDetail;
    setData(d);
    const latest = Math.max(0, ...d.versions.map((v) => v.no)) || null;
    setSelected((s) => (opts?.selectLatest ? latest ?? s : s ?? latest));
  }, [id]);
  useEffect(() => { const t = setTimeout(() => load(), 0); return () => clearTimeout(t); }, [load]);

  const active = data?.versions.some((v) => v.status === "generating" || v.status === "building") ?? false;
  useEffect(() => {
    if (!data || !active) { stuckRef.current = false; return; }
    const startedAt = Math.max(...data.versions.filter((v) => v.status === "generating" || v.status === "building").map((v) => new Date(v.createdAt).getTime()));
    const t = setInterval(async () => {
      const res = await fetch(`/api/ppt/decks/${id}?fields=status`);
      if (!res.ok) return;
      const s = (await res.json()) as PptStatusResponse;
      const stillActive = s.versions.some((v) => v.status === "generating" || v.status === "building");
      if (!stillActive) { setNotice(null); await load(); return; }
      if (Date.now() - startedAt > STUCK_MS && !stuckRef.current) {
        stuckRef.current = true;
        setNotice("생성이 14분 넘게 진행 중입니다. 서버 시간 제한(약 13분)에 걸리면 실패로 표시되며, 그때 '같은 입력으로 다시 시도'하거나 피드백으로 다시 만들 수 있습니다.");
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [data, active, id, load]);

  const version = useMemo(() => data?.versions.find((v) => v.no === selected) ?? null, [data, selected]);
  const sections = useMemo(() => (version?.deckJson ? storyboard(version.deckJson) : []), [version]);
  const currentDone = !!data && data.deck.currentVersion > 0 && data.versions.some((v) => v.no === data.deck.currentVersion && v.status === "done");

  const retry = async () => {
    if (!data || !version) return;
    try { await postJson(`/api/ppt/decks/${id}/regenerate`, { retry: true }); await load({ selectLatest: true }); }
    catch (e) { setError(e instanceof Error ? e.message : "재시도에 실패했습니다."); }
  };
  const remove = async () => {
    if (!window.confirm("이 덱과 모든 버전·파일을 삭제할까요? 되돌릴 수 없습니다.")) return;
    try { await postJson(`/api/ppt/decks/${id}`, undefined, "DELETE"); router.push("/ppt"); }
    catch (e) { setError(e instanceof Error ? e.message : "삭제에 실패했습니다."); }
  };

  if (error) return <div><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>;
  if (!data) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm"><Link href="/ppt"><ChevronLeft className="mr-1 h-4 w-4" />내 덱</Link></Button>
        <h1 className="text-lg font-semibold">{data.deck.title}</h1>
        <span className="text-xs text-muted-foreground" title={data.deck.ownerEmail}>{data.deck.ownerLabel ?? data.deck.ownerEmail}</span>
        <div className="ml-auto flex items-center gap-2">
          {version && <StatusBadge status={version.status} />}
          <Button variant="ghost" size="sm" onClick={remove} aria-label="삭제"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <Tabs value={String(selected ?? "")} onValueChange={(v) => setSelected(Number(v))}>
        <TabsList>{data.versions.map((v) => <TabsTrigger key={v.no} value={String(v.no)}>v{v.no}</TabsTrigger>)}</TabsList>
      </Tabs>
      {active && notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          {version?.status === "done" && version.deckJson ? <Storyboard sections={sections} /> :
            version?.status === "failed" ? (
              <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-2"><span className="whitespace-pre-wrap">{version.error}</span>
                {data.deck.canManage && <Button size="sm" variant="outline" onClick={retry} disabled={active}>같은 입력으로 다시 시도</Button>}</AlertDescription></Alert>
            ) : version ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {version.status === "building" ? "PPT 파일을 만드는 중입니다." : "원고를 읽고 장표를 고르는 중입니다."} 경과 <ElapsedSince since={version.createdAt} /> · 보통 1~3분, 긴 원고는 더 걸립니다.
              </p>
            ) : null}
          {data.deck.canManage && currentDone && version && (
            <FeedbackBox deckId={id} baseVersion={version.status === "done" ? version.no : data.deck.currentVersion} disabled={active} onStarted={() => load({ selectLatest: true })} />
          )}
        </div>
        <div className="space-y-4">
          {version && <VersionPanel deckId={id} version={version} />}
          {data.deck.canManage && <ShareTeamsSharePoint deck={data.deck} currentDone={currentDone} sharepointUrl={version?.sharepointUrl ?? null} onChanged={load} />}
        </div>
      </div>
    </div>
  );
}
