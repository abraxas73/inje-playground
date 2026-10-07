"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Link2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

type Connection = { connected: boolean; site: string; email: string; accountName?: string; connectedAt?: string };
export default function JiraAccountCard() {
  const [status, setStatus] = useState<Connection | null>(null);
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(false);
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
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  async function change(method: "POST" | "DELETE") {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/jira/connection", { method, headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ token }) } : {}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "연결을 변경하지 못했습니다.");
      setEditing(false); setNotice(method === "POST" ? "Jira 계정이 연결되었습니다." : "Jira 연결을 해제했습니다.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "요청에 실패했습니다."); }
    finally { setToken(""); setBusy(false); }
  }
  return <Card id="jira" className="scroll-mt-20">
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4" />Jira 계정 {status?.connected && <Badge variant="secondary">연결됨</Badge>}</CardTitle>
      <p className="text-sm text-muted-foreground">내 담당 이슈를 확인하고 내 계정으로 상태 변경·댓글을 작성합니다.</p></CardHeader>
    <CardContent className="space-y-4">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {!status ? <Button variant="outline" onClick={load}>연결 상태 다시 확인</Button> : <>
        <div className="space-y-1 text-sm break-words"><p>사이트: pms-innogrid.atlassian.net</p><p>계정: {status.accountName ? `${status.accountName} · ` : ""}{status.email}</p></div>
        {(!status.connected || editing) && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void change("POST"); }}>
          <label htmlFor="jira-token" className="text-sm font-medium">개인 API 토큰</label>
          <Input id="jira-token" type="password" autoComplete="new-password" value={token} onChange={e => setToken(e.target.value)} maxLength={4096} placeholder="본인 Jira 계정의 API 토큰" disabled={busy} />
          <p className="text-xs text-muted-foreground">로그인한 회사 이메일로 발급한 토큰을 입력하세요. 토큰은 암호화하여 보관하며 다시 표시하지 않습니다. 만료되면 새 토큰으로 연결하세요.</p>
          <a className="inline-block text-sm text-primary underline" href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">Atlassian에서 API 토큰 발급</a>
          <p className="text-xs text-muted-foreground">일반 API 토큰을 사용할 수 있습니다. 범위 지정 토큰은 사용자 조회·이슈 읽기·댓글 작성·상태 변경 권한이 필요합니다.</p>
          <div className="flex gap-2"><Button type="submit" disabled={busy || !token.trim()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{status.connected ? "다시 연결" : "지라 연결"}</Button>{editing && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setToken(""); }}>취소</Button>}</div>
        </form>}
        {status.connected && !editing && <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/jira">내 Jira 업무</Link></Button>
          <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>다시 연결</Button>
          <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" disabled={busy}>해제</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Jira 연결을 해제할까요?</AlertDialogTitle><AlertDialogDescription>앱에 저장된 연결 정보가 삭제됩니다. Jira 이슈와 댓글은 유지됩니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => void change("DELETE")}>연결 해제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
        </div>}
      </>}
    </CardContent>
  </Card>;
}
