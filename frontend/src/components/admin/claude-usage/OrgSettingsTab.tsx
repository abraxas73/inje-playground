"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check, RefreshCw } from "lucide-react";
import { buildManagedSettings } from "@/lib/claude-usage/managed-settings";
import type { ClaudeOrg } from "@/types/claude-usage";

interface Health { tokenConfigured: boolean; serviceKeyConfigured: boolean; lastReceivedAt: string | null; count24h: number; errors24h: number; lastError: string | null; orgLastDay: { org_id: string; last_day: string }[] }

export default function OrgSettingsTab({ orgs, onOrgsChange }: { orgs: ClaudeOrg[]; onOrgsChange: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [edit, setEdit] = useState<Record<string, { name: string; seats: string }>>({});
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://inje-playground.vercel.app";
  const json = JSON.stringify(buildManagedSettings(origin), null, 2);

  const loadHealth = () => fetch("/api/admin/claude-usage/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  useEffect(() => { loadHealth(); }, []);

  const save = async (o: ClaudeOrg) => {
    const e = edit[o.id];
    if (!e) return;
    const seats = e.seats.trim() === "" ? null : Number(e.seats);
    const r = await fetch("/api/admin/claude-usage/orgs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: o.id, name: e.name, seats_total: seats }) });
    if (r.ok) { setEdit((s) => { const n = { ...s }; delete n[o.id]; return n; }); onOrgsChange(); }
  };
  const copy = async () => { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const lastDay = new Map((health?.orgLastDay ?? []).map((x) => [x.org_id, x.last_day]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">수집 상태 <Button size="sm" variant="ghost" onClick={loadHealth}><RefreshCw className="h-3.5 w-3.5" /></Button></CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1">
          {!health ? <p className="text-muted-foreground">불러오는 중...</p> : (
            <>
              <p>서비스 키: {health.serviceKeyConfigured ? "✅ 구성됨" : "❌ SUPABASE_SERVICE_ROLE_KEY 없음"} · 수집 토큰: {health.tokenConfigured ? "✅ 구성됨" : "❌ CLAUDE_OTEL_INGEST_TOKEN 없음"}</p>
              <p>최근 수신: {health.lastReceivedAt ? new Date(health.lastReceivedAt).toLocaleString("ko-KR") : "없음"} · 24시간 수신 {health.count24h}건 · 오류 {health.errors24h}건</p>
              {health.lastError && <p className="text-destructive">마지막 오류: {health.lastError}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">조직 ({orgs.length})</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-2 text-xs text-muted-foreground">조직 ID는 OTel(`organization.id`)·CSV 파일명에서 자동 등록됩니다. 표시 이름과 총 시트 수(결제 페이지 기준)를 입력하세요.</p>
          <table className="w-full text-xs">
            <thead className="bg-muted/50"><tr><th className="px-2 py-1 text-left">조직 ID</th><th className="px-2 py-1 text-left">이름</th><th className="px-2 py-1 text-right">총 시트</th><th className="px-2 py-1 text-left">마지막 데이터</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {orgs.map((o) => {
                const e = edit[o.id] ?? { name: o.name, seats: o.seats_total?.toString() ?? "" };
                return (
                  <tr key={o.id} className="border-t">
                    <td className="px-2 py-1 font-mono text-[10px]">{o.id}</td>
                    <td className="px-2 py-1"><Input className="h-7 text-xs" value={e.name} onChange={(ev) => setEdit((s) => ({ ...s, [o.id]: { ...e, name: ev.target.value } }))} /></td>
                    <td className="px-2 py-1"><Input className="h-7 w-20 text-right text-xs" inputMode="numeric" value={e.seats} onChange={(ev) => setEdit((s) => ({ ...s, [o.id]: { ...e, seats: ev.target.value } }))} /></td>
                    <td className="px-2 py-1">{lastDay.get(o.id) ?? "—"}</td>
                    <td className="px-2 py-1 text-right"><Button size="sm" variant="outline" disabled={!edit[o.id]} onClick={() => save(o)}>저장</Button></td>
                  </tr>
                );
              })}
              {orgs.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">아직 등록된 조직이 없습니다. 관리형 설정을 적용하거나 CSV를 업로드하면 자동 등록됩니다.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Claude Code 관리형 설정 (조직마다 1회 적용)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>claude.ai → 관리자 설정 → Claude Code → <b>관리형 설정 &gt; 관리</b> (Owner/Primary Owner)</li>
            <li>아래 JSON을 붙여 넣고 <code>&lt;CLAUDE_OTEL_INGEST_TOKEN&gt;</code>을 실제 토큰(Vercel 환경변수 값)으로 바꾼 뒤 저장</li>
            <li>구성원은 다음 Claude Code 실행 시 <b>OTEL_EXPORTER_OTLP_ENDPOINT 승인 대화상자</b>를 1회 봅니다(승인 필요). 1시간 이내 수집 상태에 반영됩니다.</li>
          </ol>
          <div className="relative">
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-[11px]">{json}</pre>
            <Button size="sm" variant="outline" className="absolute right-2 top-2" onClick={copy}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
