"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SharepointFolder } from "@/types/rfp";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

/**
 * 개인 설정: RFP 분석 결과를 올릴 SharePoint **기본 폴더**.
 * 프로젝트에 폴더가 지정돼 있으면 그것이 우선이고, 없을 때 이 폴더로 올라간다.
 * 링크 해석·업로드 모두 본인 Microsoft 계정 권한으로 이뤄진다.
 */
export default function SharepointFolderCard() {
  const [folder, setFolder] = useState<SharepointFolder | null>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users/sharepoint-folder");
      if (!res.ok) throw new Error(await readError(res, "기본 폴더를 불러오지 못했습니다."));
      setFolder(((await res.json()) as { folder: SharepointFolder | null }).folder);
    } catch (e) {
      setError(e instanceof Error ? e.message : "기본 폴더를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/users/sharepoint-folder", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok) throw new Error(await readError(res, "폴더를 저장하지 못했습니다."));
      setFolder(((await res.json()) as { folder: SharepointFolder }).folder);
      setUrl("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "폴더를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users/sharepoint-folder", { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(await readError(res, "해제하지 못했습니다."));
      setFolder(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "해제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          SharePoint 업로드 기본 폴더
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          RFP 분석 결과(xlsx)를 올릴 기본 폴더입니다. 프로젝트에 폴더를 지정하면 그쪽이 우선이고, 지정하지 않은 프로젝트는 이 폴더로 올라갑니다.
          업로드는 항상 <span className="font-medium text-foreground">본인 Microsoft 계정</span> 권한으로 이뤄집니다(위 카드에서 연결).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />불러오는 중…
          </div>
        ) : folder ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{folder.name}</div>
              <div className="truncate text-xs text-muted-foreground" title={folder.webUrl}>{folder.webUrl}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <a href={folder.webUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                폴더 열기<ExternalLink className="h-3.5 w-3.5" />
              </a>
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" disabled={busy} onClick={clear}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />해제
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">아직 기본 폴더가 없습니다. SharePoint에서 폴더의 “링크 복사” 값을 붙여 넣으세요.</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && save()}
            placeholder="https://…sharepoint.com/… 폴더 링크"
            className="h-9 min-w-[16rem] flex-1 text-sm"
          />
          <Button size="sm" className="h-9" disabled={busy || !url.trim()} onClick={save}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : saved ? <Check className="mr-1 h-4 w-4" /> : null}
            {folder ? "폴더 변경" : "폴더 지정"}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
