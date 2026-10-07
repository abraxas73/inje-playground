"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Link2, RefreshCw, Unlink, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
type Connection = { connected: boolean; configured: boolean; needsReconnect: boolean; email: string; accountName?: string; connectedAt?: string };
export default function JiraAccountCard() {
  const [status, setStatus] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jira/connection", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Jira 연결 상태를 불러오지 못했습니다.");
      setStatus(data);
    } catch (e) { setError(e instanceof Error ? e.message : "조회에 실패했습니다."); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = new URLSearchParams(window.location.search);
      if (q.get("jira_error")) setError(q.get("jira_error"));
      else if (q.get("jira_connected") === "1") setNotice("Jira 계정이 연결되었습니다.");
      void load();
    }, 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);
  async function disconnect() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/jira/connection", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "연결을 해제하지 못했습니다.");
      setNotice("Jira 연결을 해제했습니다."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "요청에 실패했습니다."); }
    finally { setBusy(false); }
  }
  return <Card id="jira" className="scroll-mt-20">
    <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4" />Jira 계정 {status?.connected && <Badge variant="secondary" className="text-xs font-normal">연결됨</Badge>}</CardTitle>
      <p className="text-xs text-muted-foreground">회사 Atlassian 계정으로 로그인하면 내 담당 업무를 확인하고 상태 변경·댓글을 작성할 수 있습니다.</p></CardHeader>
    <CardContent className="space-y-3">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {!status ? <Button variant="outline" onClick={load}>연결 상태 다시 확인</Button> : <>
        <div className="space-y-1 break-words text-sm"><p>사이트: pms-innogrid.atlassian.net</p><p>계정: {status.accountName ? `${status.accountName} · ` : ""}{status.email}</p></div>
        {status.needsReconnect && <p className="text-sm">연결 방식이 Atlassian 로그인으로 변경되었습니다. 한 번 다시 연결해 주세요.</p>}
        {!status.configured && <p className="text-sm text-muted-foreground">회사 Jira 로그인 설정을 준비 중입니다. 관리자 설정이 완료되면 연결할 수 있습니다.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            {status.configured && <Button asChild size="sm" variant="outline" disabled={busy}><a href="/api/jira/connect">{status.connected ? <RefreshCw className="mr-1 h-4 w-4" /> : <Link2 className="mr-1 h-4 w-4" />}{status.connected ? "다시 연결" : "연결"}</a></Button>}
            {(status.connected || status.needsReconnect) && <AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="ghost" disabled={busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Unlink className="mr-1 h-4 w-4" />}해제</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Jira 연결을 해제할까요?</AlertDialogTitle><AlertDialogDescription>앱에 저장된 연결 정보가 삭제됩니다. Jira 이슈와 댓글은 유지됩니다. Atlassian 계정의 연결된 앱에서도 접근 권한을 철회할 수 있습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => void disconnect()}>연결 해제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
          </div>
          {status.configured && status.connected && <Button asChild size="sm" variant="outline"><Link href="/jira">내 Jira 업무</Link></Button>}
        </div>
      </>}
    </CardContent>
  </Card>;
}
