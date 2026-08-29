"use client";

import { Fragment, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, User } from "lucide-react";
import type { UserRole, UserRoleInfo } from "@/lib/roles";

interface Detail {
  profile: UserRoleInfo;
  isSelf: boolean;
  settings: { key: string; value: string | null }[];
  logins: Record<string, unknown>[];
  directory: { division: string | null; headquarters: string | null; team: string | null; duty: string | null; position: string | null; active: boolean; dept_path: string | null } | null;
  activity: {
    guide_questions: number | null;
    team_members: number | null;
    claude_code_30d: { sessions: number; cost_usd: number; prompts: number; active_days: number; last_day: string | null; since: string } | null;
  };
}

const ROLE_LABEL: Record<UserRole, string> = { admin: "관리자", user: "사용자", guest: "게스트" };
const SETTING_LABEL: Record<string, string> = {
  dooray_token: "Dooray 토큰", dooray_project_id: "Dooray 프로젝트 ID", dooray_project_name: "Dooray 프로젝트",
  dooray_member_id: "Dooray 멤버 ID", dooray_member_name: "Dooray 본인인증",
};

function fmt(iso: unknown): string {
  if (typeof iso !== "string") return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
/** login_history 행에서 시각·IP·UA를 열 이름에 덜 의존하도록 뽑는다 */
function loginFields(r: Record<string, unknown>) {
  const at = (r.created_at ?? r.logged_in_at ?? r.login_at ?? r.at) as unknown;
  const ip = (r.ip_address ?? r.ip) as unknown;
  const ua = String(r.user_agent ?? "");
  const short = ua.match(/(Chrome|Safari|Firefox|Edg|Mobile)[/ ][\d.]+/g)?.slice(0, 2).join(" ") || ua.slice(0, 40);
  return { at: fmt(at), ip: typeof ip === "string" ? ip : "—", ua: short };
}

export default function UserDetailSheet({ userId, onClose, onChanged }: { userId: string | null; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setDetail(null); setError(null); setResult(null);
    fetch(`/api/users/${userId}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Detail; })
      .then((j) => { if (!cancelled) setDetail(j); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [userId]);

  const changeRole = async (role: UserRole) => {
    if (!detail) return;
    setBusy(true);
    try {
      const r = await fetch("/api/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: detail.profile.user_id, role }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setDetail({ ...detail, profile: { ...detail.profile, role } });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!detail) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/users/${detail.profile.user_id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const parts = Object.entries(j.deleted ?? {}).map(([t, n]) => `${t} ${n}`).join(", ");
      setResult(`삭제 완료 — ${parts}${j.warning ? ` · ⚠️ ${j.warning}` : ""}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); setConfirmOpen(false);
    }
  };

  const p = detail?.profile;
  const canDelete = !!detail && !detail.isSelf && p?.role !== "admin" && !result;
  const cc = detail?.activity.claude_code_30d;

  return (
    <Sheet open={!!userId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            {p?.avatar_url ? <img src={p.avatar_url} alt="" className="h-9 w-9 rounded-full" /> : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted"><User className="h-4 w-4 text-muted-foreground" /></div>}
            <span className="truncate">{p ? (p.display_name || p.email) : "사용자 상세"}</span>
          </SheetTitle>
          <SheetDescription className="truncate">{p?.email ?? (error ? "" : "불러오는 중...")}</SheetDescription>
        </SheetHeader>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        {result && <p className="mt-3 rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-800">{result}</p>}

        {detail && p && (
          <div className="mt-4 space-y-5 text-sm">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground">계정</h3>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{ROLE_LABEL[p.role] ?? p.role}</Badge>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <Select value={p.role} onValueChange={(v) => changeRole(v as UserRole)} disabled={detail.isSelf || !!result}>
                      <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">관리자</SelectItem>
                        <SelectItem value="user">사용자</SelectItem>
                        <SelectItem value="guest">게스트</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <dl className="grid grid-cols-[92px_1fr] gap-y-1 text-xs">
                <dt className="text-muted-foreground">가입</dt><dd>{fmt(p.created_at)}</dd>
                <dt className="text-muted-foreground">최근 로그인</dt><dd>{p.last_login_at ? fmt(p.last_login_at) : "기록 없음"}</dd>
                <dt className="text-muted-foreground">user_id</dt><dd className="font-mono text-[10px] break-all">{p.user_id}</dd>
              </dl>
            </section>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold text-muted-foreground">사내 소속 (조직도)</h3>
              {detail.directory ? (
                <div className="text-xs">
                  <p title={detail.directory.dept_path ?? undefined}>{[detail.directory.division, detail.directory.headquarters, detail.directory.team].filter((v, i, a) => v && a.indexOf(v) === i).join(" › ")}</p>
                  <p className="text-muted-foreground">{[detail.directory.duty, detail.directory.position].filter(Boolean).join(" · ") || "—"}{!detail.directory.active && " · 비활성(명부에 없음)"}</p>
                </div>
              ) : <p className="text-xs text-muted-foreground">조직도 명부에 없는 이메일입니다.</p>}
            </section>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold text-muted-foreground">활동</h3>
              <dl className="grid grid-cols-[92px_1fr] gap-y-1 text-xs">
                <dt className="text-muted-foreground">가이드 질의</dt><dd>{detail.activity.guide_questions ?? "—"}건</dd>
                <dt className="text-muted-foreground">내 팀 인원</dt><dd>{detail.activity.team_members ?? "—"}명</dd>
                <dt className="text-muted-foreground">Claude Code</dt>
                <dd>{cc ? (cc.sessions > 0 || cc.cost_usd > 0
                  ? `최근 30일 세션 ${cc.sessions.toLocaleString()} · 프롬프트 ${cc.prompts.toLocaleString()} · $${cc.cost_usd.toFixed(2)} · 활동 ${cc.active_days}일 (마지막 ${cc.last_day})`
                  : `최근 30일 사용 없음(${cc.since}~)`) : "—"}</dd>
              </dl>
            </section>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold text-muted-foreground">개인 설정 ({detail.settings.length})</h3>
              {detail.settings.length === 0 ? <p className="text-xs text-muted-foreground">없음</p> : (
                <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-xs">
                  {detail.settings.map((s) => (<Fragment key={s.key}><dt className="text-muted-foreground">{SETTING_LABEL[s.key] ?? s.key}</dt><dd className="break-all">{s.value ?? "—"}</dd></Fragment>))}
                </dl>
              )}
            </section>

            <section className="space-y-1">
              <h3 className="text-xs font-semibold text-muted-foreground">최근 로그인 ({detail.logins.length})</h3>
              {detail.logins.length === 0 ? <p className="text-xs text-muted-foreground">기록 없음</p> : (
                <ul className="space-y-0.5 text-xs">
                  {detail.logins.map((r, i) => { const f = loginFields(r); return (<li key={i} className="flex justify-between gap-2"><span>{f.at}</span><span className="text-muted-foreground truncate">{f.ip} · {f.ua}</span></li>); })}
                </ul>
              )}
            </section>

            <section className="rounded-md border border-destructive/30 p-3">
              <h3 className="text-xs font-semibold text-destructive">위험 구역</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                프로필·개인 설정·내 팀·로그인 이력·가이드 질의 기록을 삭제하고 로그인 계정도 제거합니다. 같은 계정으로 다시 로그인하면 <b>게스트</b>로 새로 생성됩니다. Claude 사용량 통계(이메일 기준)는 남습니다.
              </p>
              {detail.isSelf && <p className="mt-1 text-xs text-muted-foreground">자기 자신은 삭제할 수 없습니다.</p>}
              {!detail.isSelf && p.role === "admin" && <p className="mt-1 text-xs text-muted-foreground">관리자 계정은 먼저 역할을 &apos;사용자&apos;로 바꾼 뒤 삭제할 수 있습니다.</p>}
              <Button variant="destructive" size="sm" className="mt-2" disabled={!canDelete || busy} onClick={() => setConfirmOpen(true)}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />사용자 삭제
              </Button>
            </section>
          </div>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>정말 삭제할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                <b>{p?.display_name || p?.email}</b> ({p?.email}) 계정과 개인 데이터가 삭제됩니다. 되돌릴 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); remove(); }} disabled={busy} className="bg-destructive text-white hover:bg-destructive/90">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "삭제"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
