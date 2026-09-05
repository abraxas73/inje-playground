"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useMsCallbackQuery } from "@/hooks/useMsCallbackQuery";
import type { MsConnectionStatus } from "@/types/ms";

/** Microsoft 계정 연결 시작 URL — 연결이 끝나면 returnTo(같은 오리진 경로)로 돌아온다 */
export function connectUrl(returnTo: string): string {
  return `/api/ms/connect?returnTo=${encodeURIComponent(returnTo)}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

/** 개인 설정: SharePoint 업로드에 쓰는 Microsoft 계정 연결 상태·연결·해제 */
export default function MicrosoftAccountCard() {
  const [status, setStatus] = useState<MsConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ms/connection");
      if (!res.ok) throw new Error(await readError(res, "연결 상태를 불러오지 못했습니다."));
      setStatus((await res.json()) as MsConnectionStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결 상태를 불러오지 못했습니다.");
      setStatus({ connected: false });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useMsCallbackQuery({
    onConnected: () => {
      setNotice("Microsoft 계정이 연결되었습니다.");
      setError(null);
      void load();
    },
    onError: (message) => setError(message),
  });

  const connect = () => {
    window.location.assign(connectUrl("/settings"));
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/ms/connection", { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "연결을 해제하지 못했습니다."));
      setStatus({ connected: false });
      setNotice("연결을 해제했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결을 해제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Cloud className="h-4 w-4" />
          Microsoft 계정
          {status?.connected && (
            <Badge variant={status.lastError ? "destructive" : "secondary"} className="text-xs font-normal">
              {status.lastError ? "다시 연결 필요" : "연결됨"}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          RFP 분석 결과를 SharePoint에 올릴 때 쓰는 계정입니다. 연결하면 서버가 갱신 토큰을 암호화해 보관하고, 업로드는 내 계정 권한으로 실행됩니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}

        {status === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중...
          </div>
        ) : !status.connected ? (
          <>
            <p className="text-sm text-muted-foreground">연결된 계정이 없습니다.</p>
            <Button size="sm" onClick={connect}>
              <Link2 className="mr-1 h-4 w-4" />
              Microsoft 계정 연결
            </Button>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">계정</dt>
              <dd>
                {status.accountName ?? "—"}
                {status.accountUpn && <span className="ml-1 text-muted-foreground">({status.accountUpn})</span>}
              </dd>
              <dt className="text-muted-foreground">연결</dt>
              <dd>{new Date(status.connectedAt).toLocaleString("ko-KR")}</dd>
              <dt className="text-muted-foreground">마지막 사용</dt>
              <dd>{status.lastUsedAt ? new Date(status.lastUsedAt).toLocaleString("ko-KR") : "—"}</dd>
            </dl>
            {status.lastError && (
              <Alert variant="destructive">
                <AlertDescription>연결이 만료되었습니다. 다시 연결하세요. ({status.lastError})</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={connect} disabled={busy}>
                <RefreshCw className="mr-1 h-4 w-4" />
                다시 연결
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={busy}>
                    {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Unlink className="mr-1 h-4 w-4" />}
                    해제
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Microsoft 계정 연결을 해제할까요?</AlertDialogTitle>
                    <AlertDialogDescription>저장된 갱신 토큰을 삭제합니다. 이미 올라간 파일과 프로젝트의 폴더 설정은 그대로 남습니다.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction onClick={disconnect}>해제</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
