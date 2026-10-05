"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import type { MentionItem } from "@/lib/teams/mentions";

type State = { kind: "loading" } | { kind: "connect" } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; items: MentionItem[] };

/** Remount on account change; never persist message text or let old responses update a new account. */
export default function TeamsReplyCard() {
  const { userId, canAccessPage } = useUserRole();
  if (!userId || !canAccessPage("/teams/chat")) return null;
  return <ReplyList key={userId} />;
}

function ReplyList() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/teams/mentions?days=2", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!active) return;
        if (response.status === 401 || response.status === 403) { setState({ kind: "forbidden" }); return; }
        if (response.status === 409 || (response.status === 400 && data.code === "not_connected")) { setState({ kind: "connect" }); return; }
        if (!response.ok) throw new Error("mentions failed");
        if (data.connected === false) { setState({ kind: "connect" }); return; }
        if (data.connected !== true || !Array.isArray(data.items)) throw new Error("invalid mentions");
        setState({ kind: "ready", items: data.items.slice(0, 10) });
      } catch {
        if (active) setState({ kind: "error" });
      } finally { clearTimeout(timer); }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [revision]);
  const refresh = () => { setState({ kind: "loading" }); setRevision((n) => n + 1); };
  if (state.kind === "forbidden") return null;
  return <section aria-labelledby="teams-replies-title" className="mb-8 rounded-xl border bg-card p-5 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="teams-replies-title" className="flex items-center gap-2 font-semibold"><MessageCircle aria-hidden="true" className="h-5 w-5 text-primary" />Teams 답장 대기</h2>
      <Button variant="ghost" size="sm" onClick={refresh} disabled={state.kind === "loading"}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${state.kind === "loading" ? "animate-spin" : ""}`} />새로고침</Button>
    </div>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">최근 2일의 1:1 대화와 내 이름이 언급된 그룹 메시지 중 내 답장이 뒤따르지 않은 항목입니다. 읽음 여부와는 다르며, 최근 활동 채팅 최대 15개에서 10건까지 확인합니다.</p>
    {state.kind === "loading" && <p role="status" className="mt-4 text-sm text-muted-foreground">답장 대기를 확인하고 있습니다…</p>}
    {state.kind === "connect" && <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><p>Microsoft 계정을 연결하거나 Teams 채팅 권한을 추가해 주세요.</p><Link href="/settings" className="font-medium text-primary hover:underline">연결 설정 열기</Link></div>}
    {state.kind === "error" && <div className="mt-4 flex items-center gap-3"><p role="alert" className="text-sm text-destructive">답장 대기를 불러오지 못했습니다.</p><Button variant="outline" size="sm" onClick={refresh}>다시 시도</Button></div>}
    {state.kind === "ready" && (state.items.length ? <ul className="mt-4 divide-y">
      {state.items.map((item) => <li key={`${item.chatId}:${item.id}`}>
        <Link href={`/teams/chat?${new URLSearchParams({ chat: item.chatId })}`} className="block rounded-lg px-2 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><span className="text-sm font-medium">{item.from} · {item.topic || "1:1 채팅"}</span><time dateTime={item.at} className="text-xs text-muted-foreground">{new Date(item.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div>
          <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{item.text}</p>
        </Link>
      </li>)}
    </ul> : <p className="mt-4 text-sm text-muted-foreground">조회한 대화에서 답장 대기 항목이 없습니다.</p>)}
    <Link href="/teams/chat" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">Teams 채팅 열기 →</Link>
  </section>;
}
