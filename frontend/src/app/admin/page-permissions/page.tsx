"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, ShieldCheck, Save, RotateCcw } from "lucide-react";
import { PAGE_GROUPS, PAGES, canUsePage, type PagePermissions, type PageKey } from "@/lib/page-access";
import type { UserRole } from "@/lib/roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface AccessUser { user_id: string; display_name: string | null; email: string; role: UserRole; permissions: PagePermissions; version: number; updated_at: string | null }
const roleLabels = { guest: "게스트", user: "사용자", admin: "관리자" };

export default function PagePermissionsPage() {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PagePermissions>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [reload, setReload] = useState(0);
  const selected = users.find((u) => u.user_id === selectedId);
  const changed = selected ? PAGES.filter((p) => selected.permissions[p.key] !== draft[p.key]).length : 0;
  const filtered = users.filter((u) => `${u.display_name ?? ""} ${u.email}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/page-permissions", { cache: "no-store", signal: controller.signal })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error); return body.users as AccessUser[]; })
      .then((rows) => {
        if (controller.signal.aborted) return;
        setUsers(rows); setSelectedId(null); setDraft({}); setMessage(null); setLoading(false);
      })
      .catch((e) => { if (!controller.signal.aborted) { setMessage({ text: e instanceof Error ? e.message : "목록을 불러오지 못했습니다.", error: true }); setLoading(false); } });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);

  function selectUser(user: AccessUser) {
    if (user.user_id === selectedId) return;
    if (changed && !window.confirm("저장하지 않은 변경사항을 버리고 다른 사용자를 선택할까요?")) return;
    setSelectedId(user.user_id); setDraft(user.permissions); setMessage(null);
  }
  function reloadUsers() {
    if (changed && !window.confirm("변경사항을 버리고 최신 권한을 불러올까요?")) return;
    setLoading(true); setReload((n) => n + 1);
  }
  function setPage(key: PageKey, allowed: boolean) { setDraft((old) => ({ ...old, [key]: allowed })); setMessage(null); }
  async function save() {
    if (!selected || selected.role === "admin") return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/admin/page-permissions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: selected.user_id, permissions: draft, version: selected.version }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "저장하지 못했습니다.");
      setUsers((old) => old.map((u) => u.user_id === selected.user_id ? { ...u, ...body.access } : u));
      setDraft(body.access.permissions);
      setMessage({ text: `${selected.display_name ?? selected.email}님의 페이지 접근 권한을 저장했습니다.`, error: false });
      window.dispatchEvent(new Event("page-access-updated"));
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "저장하지 못했습니다.", error: true }); }
    finally { setSaving(false); }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">페이지 접근 권한</h2><p className="mt-1 text-sm text-muted-foreground">사용자를 선택하고 접근할 수 있는 페이지를 설정하세요. 저장 전까지 기존 권한을 유지합니다.</p></div>
      <Button variant="outline" size="sm" disabled={loading || saving} onClick={reloadUsers}><RotateCcw className="h-4 w-4" />목록 새로고침</Button>
    </div>
    {message && <p role={message.error ? "alert" : "status"} className={cn("rounded-lg border p-3 text-sm", message.error ? "border-destructive/30 text-destructive" : "border-primary/20 text-primary")}>{message.text}</p>}
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card>
        <CardHeader><CardTitle className="flex items-center justify-between text-base">사용자 <Badge variant="secondary">{users.length}명</Badge></CardTitle>
          <div className="relative mt-3"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="이름 또는 이메일 검색" placeholder="이름 또는 이메일 검색" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" /></div>
        </CardHeader>
        <CardContent className="max-h-[620px] space-y-1 overflow-y-auto">
          {loading ? <p role="status" className="flex gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />사용자를 불러오고 있습니다.</p> : filtered.length ? filtered.map((u) => <button key={u.user_id} disabled={saving} onClick={() => selectUser(u)} aria-pressed={selectedId === u.user_id} className={cn("w-full rounded-lg border p-3 text-left transition-colors disabled:opacity-50", selectedId === u.user_id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50")}>
            <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{u.display_name || u.email}</span><Badge variant="outline" className="shrink-0 text-[10px]">{roleLabels[u.role]}</Badge></span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{u.email}</span>
          </button>) : <p className="py-8 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</p>}
        </CardContent>
      </Card>
      <Card>
        {!selected || loading ? <CardContent className="flex min-h-80 flex-col items-center justify-center gap-3 text-muted-foreground"><ShieldCheck className="h-10 w-10" /><p className="text-sm">권한을 설정할 사용자를 선택하세요.</p></CardContent> : <>
          <CardHeader className="border-b">
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">{selected.display_name || selected.email}<Badge variant="secondary">{roleLabels[selected.role]}</Badge></CardTitle>
            <p className="text-sm text-muted-foreground">{selected.email}</p>
            <p className="text-xs text-muted-foreground">{selected.role === "admin" ? "관리자는 모든 페이지에 접근할 수 있으며 개별 제한을 적용하지 않습니다." : "차단하면 메뉴·홈 카드와 직접 주소·관련 API 접근이 제한됩니다. 기존 역할보다 높은 권한은 부여할 수 없습니다."}</p>
          </CardHeader>
          <CardContent className="space-y-6 pt-5">
            {PAGE_GROUPS.map((group) => {
              const pages = PAGES.filter((p) => p.group === group.id);
              const editable = pages.filter((p) => canUsePage(selected.role, p.key));
              const allAllowed = editable.every((p) => canUsePage(selected.role, p.key, draft));
              return <section key={group.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{group.label}</h3><Button size="sm" variant="ghost" disabled={saving || selected.role === "admin" || !editable.length} onClick={() => { setDraft((old) => ({ ...old, ...Object.fromEntries(editable.map((p) => [p.key, !allAllowed])) })); setMessage(null); }}>{allAllowed ? "그룹 차단" : "그룹 허용"}</Button></div>
                <div className="divide-y rounded-lg border">{pages.map((page) => {
                  const allowed = canUsePage(selected.role, page.key, draft);
                  const roleAllowed = canUsePage(selected.role, page.key);
                  return <div key={page.key} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div><Label htmlFor={`access-${page.key}`} className="font-medium">{page.label}</Label><p className="mt-1 text-xs text-muted-foreground">{!roleAllowed ? "사용자 이상 역할 필요" : draft[page.key] === undefined || selected.role === "admin" ? "역할 기본값" : "개별 설정"}</p></div>
                    <div className="flex items-center gap-3"><span className={cn("text-xs", allowed ? "text-primary" : "text-muted-foreground")}>{allowed ? "허용" : "차단"}</span><Switch id={`access-${page.key}`} checked={allowed} disabled={saving || selected.role === "admin" || !roleAllowed} onCheckedChange={(checked) => setPage(page.key, checked)} /></div>
                  </div>;
                })}</div>
              </section>;
            })}
            <p className="text-xs leading-relaxed text-muted-foreground">설정·프로필·사용자 매뉴얼은 공통 메뉴로 유지됩니다. 공개 설문과 외부 RFP 공유 링크의 익명 접근은 각 공개 설정을 따릅니다. 기존 인사·부고 메일 예약은 페이지 접근 제한과 별도로 유지됩니다.</p>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <Button variant="outline" disabled={saving || selected.role === "admin" || !Object.keys(draft).length} onClick={() => { setDraft({}); setMessage(null); }}><RotateCcw className="h-4 w-4" />기본 권한으로 되돌리기</Button>
              <div className="flex items-center gap-3"><span role="status" className="text-xs text-muted-foreground">{changed ? `${changed}개 변경 · 저장 필요` : "저장된 상태"}</span><Button disabled={saving || !changed || selected.role === "admin"} onClick={save}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}변경사항 저장</Button></div>
            </div>
          </CardContent>
        </>}
      </Card>
    </div>
  </div>;
}
