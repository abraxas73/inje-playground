"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Connection = { configured: boolean; connected: boolean; accountName?: string; email?: string };
export default function DoorayAccountCard() {
  const [status, setStatus] = useState<Connection | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dooray/connection", { cache: "no-store", signal: controller.signal })
      .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error || "연결 상태를 불러오지 못했습니다."); if (!controller.signal.aborted) setStatus(data); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "조회에 실패했습니다."); });
    return () => controller.abort();
  }, []);
  async function save(method: "PUT" | "DELETE") {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/dooray/connection", { method, ...(method === "PUT" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token.trim() }) } : {}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "연결 정보를 저장하지 못했습니다.");
      setToken("");
      const result = await fetch("/api/dooray/connection", { cache: "no-store" });
      const connection = await result.json();
      if (!result.ok) throw new Error(connection.error || "연결 상태를 불러오지 못했습니다.");
      setStatus(connection);
      setNotice(method === "PUT" ? "Dooray 계정이 연결되었습니다." : "Dooray 연결을 해제했습니다.");
    } catch (e) { setError(e instanceof Error ? e.message : "요청에 실패했습니다."); }
    finally { setToken(""); setBusy(false); }
  }
  return <Card id="dooray" className="scroll-mt-20">
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4" />Dooray 계정 {status?.connected && <Badge variant="secondary">연결됨</Badge>}</CardTitle><p className="text-xs text-muted-foreground">이노크루와 별도인 본인의 Dooray 계정을 연결합니다. 개인 API 토큰으로 일정·최근 메일 소식·대화방을 확인합니다. 전체 메일함은 별도 IMAP 연동이 필요합니다.</p></CardHeader>
    <CardContent className="space-y-3">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {!status && !error && <p role="status" className="text-sm">연결 상태 확인 중…</p>}
      {status && !status.configured && <p className="text-sm text-muted-foreground">회사 Dooray 연동 설정을 준비 중입니다. 관리자 설정이 완료되면 연결할 수 있습니다.</p>}
      {status?.connected && <p className="break-words text-sm">계정: {status.accountName} {status.email}</p>}
      {status?.configured && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save("PUT"); }}>
        <label htmlFor="dooray-token" className="text-sm">개인 API 토큰</label>
        <Input id="dooray-token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} disabled={busy} placeholder={status.connected ? "다시 연결할 토큰 입력" : "Dooray 개인 API 토큰 입력"} />
        <p className="text-xs text-muted-foreground">토큰은 서버에 암호화하여 보관하며 다시 표시하지 않습니다.</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy || !token.trim()} type="submit">{status.connected ? "다시 연결" : "연결"}</Button>{status.connected && <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => void save("DELETE")}>해제</Button>}{status.connected && <Button asChild variant="outline" size="sm"><Link href="/dooray">내 Dooray</Link></Button>}</div>
      </form>}
      {status?.connected && !status.configured && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save("DELETE")}>해제</Button>}
    </CardContent>
  </Card>;
}
