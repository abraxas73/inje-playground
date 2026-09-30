"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, CloudUpload, Copy, Loader2, MessageSquareShare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { connectUrl } from "@/components/settings/MicrosoftAccountCard";
import { postJson } from "@/lib/ppt/client";
import type { PptActionErrorCode, PptDeckDetail } from "@/types/ppt";

const withWarning = (text: string, warning?: string) => (typeof warning === "string" && warning ? `${text} (${warning})` : text);

type ApiErr = Error & { code?: PptActionErrorCode; status?: number };

export default function ShareTeamsSharePoint({ deck, currentDone, sharepointUrl, onChanged }: { deck: PptDeckDetail["deck"]; currentDone: boolean; sharepointUrl: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<"share" | "teams" | "sp" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string; code?: PptActionErrorCode } | null>(null);
  const [copied, setCopied] = useState(false);
  const [askShare, setAskShare] = useState(false);
  const base = `/api/ppt/decks/${deck.id}`;

  const run = async (kind: "share" | "teams" | "sp", fn: () => Promise<string>) => {
    setBusy(kind); setMsg(null);
    try { setMsg({ kind: "ok", text: await fn() }); onChanged(); }
    catch (e) { const err = e as ApiErr; setMsg({ kind: "error", text: err.message, code: err.code }); }
    finally { setBusy(null); }
  };
  const toggleShare = (enabled: boolean) => run("share", async () => { await postJson(`${base}/share`, { enabled }, "PUT"); return enabled ? "공유 링크를 켰습니다." : "공유 링크를 껐습니다."; });
  const sendTeams = (enableShare: boolean) => run("teams", async () => { const r = await postJson<{ ok?: boolean; shareUrl?: string | null; warning?: string }>(`${base}/teams`, { enableShare }); return withWarning("Teams 채널에 게시했습니다.", r.warning); });
  const uploadSp = () => run("sp", async () => { const r = await postJson<{ webUrl: string; folderName: string; warning?: string }>(`${base}/sharepoint`, {}); return withWarning(`SharePoint(${r.folderName})에 올렸습니다.`, r.warning); });
  const copy = async () => { if (!deck.shareUrl) return; try { await navigator.clipboard.writeText(deck.shareUrl); } catch { setMsg({ kind: "error", text: "클립보드 복사에 실패했습니다. 링크를 직접 선택해 복사하세요." }); return; } setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const returnTo = `/ppt/${deck.id}`;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">공유</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <Label htmlFor="ppt-share" className="flex flex-col items-start gap-0.5 text-left"><span>공유 링크</span><span className="text-xs font-normal text-muted-foreground">로그인한 사내 사용자만 열 수 있습니다</span></Label>
          <Switch id="ppt-share" checked={deck.shareEnabled} disabled={busy !== null} onCheckedChange={toggleShare} />
        </div>
        {deck.shareUrl && (
          <div className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1 text-xs"><span className="truncate">{deck.shareUrl}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={copy} aria-label="복사">{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}</Button></div>
        )}
        <div className="grid gap-2">
          <Button size="sm" variant="outline" className="justify-start" disabled={!currentDone || busy !== null} onClick={() => (deck.shareEnabled ? sendTeams(false) : setAskShare(true))}>
            {busy === "teams" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <MessageSquareShare className="mr-1 h-4 w-4" />}Teams로 공유</Button>
          <Button size="sm" variant="outline" className="justify-start" disabled={!currentDone || busy !== null} onClick={uploadSp}>
            {busy === "sp" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-1 h-4 w-4" />}SharePoint 업로드</Button>
        </div>
        {sharepointUrl && <div className="text-xs text-muted-foreground">SharePoint: <a className="underline" href={sharepointUrl} target="_blank" rel="noreferrer">{sharepointUrl}</a></div>}
        {msg && (
          <Alert variant={msg.kind === "error" ? "destructive" : "default"}>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{msg.text}</span>
              {msg.code === "not_connected" && <Button asChild size="sm" variant="outline"><a href={connectUrl(returnTo)}>Microsoft 계정 연결</a></Button>}
              {msg.code === "reconnect" && <Button asChild size="sm" variant="outline"><a href={connectUrl(returnTo)}>다시 연결</a></Button>}
              {msg.code === "no_folder" && <Button asChild size="sm" variant="outline"><Link href="/settings">기본 폴더 설정</Link></Button>}
              {msg.code === "no_channel" && <Button asChild size="sm" variant="outline"><Link href="/settings">알림 채널 설정</Link></Button>}
            </AlertDescription>
          </Alert>
        )}
        <AlertDialog open={askShare} onOpenChange={setAskShare}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>공유 링크를 켜고 보낼까요?</AlertDialogTitle>
              <AlertDialogDescription>공유 링크가 꺼져 있어 받는 사람이 열 수 없습니다. 링크를 켜고 Teams에 게시합니다(끄면 &quot;공유 링크가 꺼져 있습니다&quot;로 나갑니다).</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => sendTeams(false)}>링크 없이 보내기</AlertDialogCancel>
              <AlertDialogAction onClick={() => sendTeams(true)}>켜고 보내기</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
