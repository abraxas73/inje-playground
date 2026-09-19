"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { ACCOUNTLESS_HINT, formatEnv } from "@/lib/claude-usage/org-options";
import { int } from "./format";
import { useMoney } from "@/components/shared/currency-context";

interface Mapping { user_id: string; email: string; note: string | null; updated_at: string }
interface Candidate {
  user_id: string; days: number; prompts: number; sessions: number; cost_usd: number;
  first_day: string; last_day: string; os_type: string; host_arch: string; app_version: string; terminal_type: string;
}

/** 계정 미식별(SDK) 세션을 사람에게 귀속 — 설치 식별자(user.id)를 이메일에 매핑한다. */
export default function IdentityMapCard() {
  const { usd } = useMoney();
  const [data, setData] = useState<{ mappings: Mapping[]; candidates: Candidate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/claude-usage/identities", { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j; })
      .then((j) => { setData({ mappings: j.mappings ?? [], candidates: j.candidates ?? [] }); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(userId: string) {
    const email = (draft[userId] ?? "").trim();
    if (!email) return;
    setBusy(userId); setError(null);
    try {
      const r = await fetch("/api/admin/claude-usage/identities", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, email }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "저장하지 못했습니다.");
      setDraft((d) => { const next = { ...d }; delete next[userId]; return next; });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }
  async function remove(userId: string) {
    setBusy(userId); setError(null);
    try {
      const r = await fetch(`/api/admin/claude-usage/identities?user_id=${encodeURIComponent(userId)}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error ?? "해제하지 못했습니다.");
      load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  const mapped = new Set((data?.mappings ?? []).map((m) => m.user_id));
  const candidates = (data?.candidates ?? []).filter((c) => !mapped.has(c.user_id));

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">계정 미식별 세션 귀속 ({data?.mappings.length ?? 0}건 매핑)</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground">{ACCOUNTLESS_HINT}</p>
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
        {!data && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />불러오는 중…</p>}

        {data && data.mappings.length > 0 && (
          <table className="mb-4 w-full text-xs">
            <thead className="bg-muted/50"><tr><th className="px-2 py-1 text-left">식별자</th><th className="px-2 py-1 text-left">귀속 이메일</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {data.mappings.map((m) => (
                <tr key={m.user_id} className="border-t">
                  <td className="px-2 py-1 font-mono text-[10px]" title={m.user_id}>{m.user_id.slice(0, 16)}…</td>
                  <td className="px-2 py-1">{m.email}</td>
                  <td className="px-2 py-1 text-right"><Button size="sm" variant="ghost" disabled={busy === m.user_id} onClick={() => remove(m.user_id)}>해제</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {data && (
          <>
            <p className="mb-1 text-xs font-medium">최근 90일 미매핑 식별자 ({candidates.length})</p>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/50"><tr>
                  <th className="px-2 py-1 text-left">식별자</th><th className="px-2 py-1 text-left">환경</th>
                  <th className="px-2 py-1 text-right">비용</th><th className="px-2 py-1 text-right">일수</th>
                  <th className="px-2 py-1 text-right">프롬프트</th><th className="px-2 py-1 text-left">기간</th>
                  <th className="px-2 py-1 text-left">귀속 이메일</th><th className="px-2 py-1"></th>
                </tr></thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.user_id} className="border-t">
                      <td className="px-2 py-1 font-mono text-[10px]" title={c.user_id}>{c.user_id.slice(0, 12)}…</td>
                      <td className="px-2 py-1">{formatEnv({ os_type: c.os_type, host_arch: c.host_arch, app_version: c.app_version, terminal_type: c.terminal_type, points: 0 })}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{usd(c.cost_usd)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{int(c.days)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{int(c.prompts)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{c.first_day === c.last_day ? c.first_day : `${c.first_day}~${c.last_day}`}</td>
                      <td className="px-2 py-1"><Input className="h-7 text-xs" placeholder="name@innogrid.com" value={draft[c.user_id] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [c.user_id]: e.target.value }))} /></td>
                      <td className="px-2 py-1 text-right"><Button size="sm" variant="outline" disabled={busy === c.user_id || !(draft[c.user_id] ?? "").trim()} onClick={() => save(c.user_id)}>매핑</Button></td>
                    </tr>
                  ))}
                  {candidates.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-muted-foreground">미매핑 식별자가 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
