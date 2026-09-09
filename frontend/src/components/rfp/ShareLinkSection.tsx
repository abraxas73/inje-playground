"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Link2, Loader2, Lock, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { RfpShareLink, RfpShareVisibility, ShareLinksResponse } from "@/types/rfp";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

/**
 * 프로젝트 상세: 공유 링크(로그인 없이 열람 가능한 URL) 만들기·복사·폐기.
 * 프로젝트를 등록한 사람(또는 admin)에게만 보인다 — 서버가 `canManage`로 판단한다.
 */
export default function ShareLinkSection({ projectId }: { projectId: string }) {
  const [links, setLinks] = useState<RfpShareLink[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rfp/projects/${projectId}/shares`);
      if (!res.ok) throw new Error(await readError(res, "공유 링크를 불러오지 못했습니다."));
      const j = (await res.json()) as ShareLinksResponse;
      setLinks(j.links);
      setCanManage(j.canManage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "공유 링크를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (visibility: RfpShareVisibility) => {
    setBusy(visibility);
    setError(null);
    try {
      const res = await fetch(`/api/rfp/projects/${projectId}/shares`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility }),
      });
      if (!res.ok) throw new Error(await readError(res, "공유 링크를 만들지 못했습니다."));
      const { link } = (await res.json()) as { link: RfpShareLink };
      setLinks((l) => [link, ...l]);
      await copy(link.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "공유 링크를 만들지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 2000);
    } catch {
      setError("복사에 실패했습니다. 링크를 직접 선택해 복사하세요.");
    }
  };

  const revoke = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/rfp/shares/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(await readError(res, "폐기하지 못했습니다."));
      setLinks((l) => l.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "폐기하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  if (loading || (!canManage && links.length === 0)) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          공유 링크
          {links.length > 0 && <span className="text-xs font-normal text-muted-foreground">{links.length}개</span>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          이 분석 결과를 읽기 전용으로 볼 수 있는 링크입니다. <span className="font-medium text-foreground">공개</span> 링크는 로그인 없이 열리고(사외 공유),
          <span className="font-medium text-foreground"> 사내</span> 링크는 링크가 있어도 우리 계정으로 로그인해야 열립니다.
          공개 링크에서는 근거 URL(사내 주소)과 비고(내부 메모)를 감춥니다. 링크를 폐기하면 즉시 열리지 않습니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => create("public")}>
              {busy === "public" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Globe className="mr-1 h-4 w-4" />}
              공개 링크 만들기
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => create("private")}>
              {busy === "private" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Lock className="mr-1 h-4 w-4" />}
              사내 링크 만들기
            </Button>
            <span className="text-xs text-muted-foreground">만들면 링크가 클립보드에 복사됩니다.</span>
          </div>
        )}

        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 공유 링크가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                <Badge
                  variant="outline"
                  className={cn("border-transparent text-[11px]", l.visibility === "public" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700")}
                >
                  {l.visibility === "public" ? <><Globe className="mr-1 h-3 w-3" />공개</> : <><Lock className="mr-1 h-3 w-3" />사내</>}
                </Badge>
                <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={l.url}>{l.url}</code>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {l.viewCount}회 열람{l.lastViewedAt ? ` · 최근 ${fmt(l.lastViewedAt)}` : ""}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => copy(l.url)}>
                    {copied === l.url ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                    복사
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
                    <a href={l.url} target="_blank" rel="noreferrer">열기<ExternalLink className="ml-1 h-3 w-3" /></a>
                  </Button>
                  {canManage && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={busy !== null}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" />폐기
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>이 공유 링크를 폐기할까요?</AlertDialogTitle>
                          <AlertDialogDescription>
                            폐기하면 이 링크로는 더 이상 열리지 않습니다(이미 받은 사람도 포함). 분석 결과 자체는 그대로입니다.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>취소</AlertDialogCancel>
                          <AlertDialogAction onClick={() => revoke(l.id)}>폐기</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
