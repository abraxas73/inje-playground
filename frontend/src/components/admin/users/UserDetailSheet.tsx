"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, AlertTriangle, Building2, KeyRound, Loader2, LogIn, Shield, Trash2, User, UserCircle2, UserX } from "lucide-react";
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

const ROLE_META: Record<UserRole, { label: string; icon: typeof Shield; className: string }> = {
  admin: { label: "관리자", icon: Shield, className: "bg-red-50 text-red-700 border-red-200" },
  user: { label: "사용자", icon: User, className: "bg-blue-50 text-blue-700 border-blue-200" },
  guest: { label: "게스트", icon: UserX, className: "bg-gray-100 text-gray-600 border-gray-200" },
};
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

function Section({ icon: Icon, title, aside, children }: { icon: typeof Activity; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-3 shadow-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Icon className="h-3.5 w-3.5" />{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-xs leading-5 text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words leading-5">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-base font-semibold leading-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 px-4 py-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border p-3">
          <div className="mb-3 h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="space-y-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
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
  const role = p ? (ROLE_META[p.role] ?? ROLE_META.user) : null;
  const canDelete = !!detail && !detail.isSelf && p?.role !== "admin" && !result;
  const cc = detail?.activity.claude_code_30d;
  const dir = detail?.directory;
  const unitPath = dir ? [dir.division, dir.headquarters, dir.team].filter((v, i, a) => v && a.indexOf(v) === i) as string[] : [];

  return (
    <Sheet open={!!userId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b bg-muted/30 pr-12">
          <div className="flex items-center gap-3">
            {p?.avatar_url ? (
              <img src={p.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-full border" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border bg-muted"><User className="h-5 w-5 text-muted-foreground" /></div>
            )}
            <div className="min-w-0">
              <SheetTitle className="truncate text-base">{p ? (p.display_name || p.email) : "사용자 상세"}</SheetTitle>
              <SheetDescription className="truncate">{p?.email ?? (error ? "" : "불러오는 중...")}</SheetDescription>
            </div>
          </div>
          {p && role && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`gap-1 ${role.className}`}><role.icon className="h-3 w-3" />{role.label}</Badge>
              {detail?.isSelf && <Badge variant="secondary">본인</Badge>}
              {dir?.team && <Badge variant="outline" className="gap-1"><Building2 className="h-3 w-3" />{dir.team}</Badge>}
              <span className="ml-auto text-[11px] text-muted-foreground">가입 {fmt(p.created_at).slice(0, 13)}</span>
            </div>
          )}
        </SheetHeader>

        {error && <p className="mx-4 mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
        {result && <p className="mx-4 mt-4 rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-800">{result}</p>}

        {!detail && !error && <Skeleton />}

        {detail && p && role && (
          <div className="space-y-3 px-4 py-4">
            <Section
              icon={UserCircle2}
              title="계정"
              aside={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <Select value={p.role} onValueChange={(v) => changeRole(v as UserRole)} disabled={detail.isSelf || !!result}>
                  <SelectTrigger className="h-7 w-[104px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">관리자</SelectItem>
                    <SelectItem value="user">사용자</SelectItem>
                    <SelectItem value="guest">게스트</SelectItem>
                  </SelectContent>
                </Select>
              )}
            >
              <KV rows={[
                ["이메일", p.email],
                ["가입", fmt(p.created_at)],
                ["최근 로그인", p.last_login_at ? fmt(p.last_login_at) : <span className="text-muted-foreground">기록 없음</span>],
                ["user_id", <code key="uid" className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{p.user_id}</code>],
              ]} />
            </Section>

            <Section icon={Building2} title="사내 소속 (조직도)">
              {dir ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1 text-sm" title={dir.dept_path ?? undefined}>
                    {unitPath.map((u, i) => (
                      <Fragment key={u}>
                        {i > 0 && <span className="text-muted-foreground">›</span>}
                        <span className={i === unitPath.length - 1 ? "font-medium" : ""}>{u}</span>
                      </Fragment>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {dir.duty && <Badge variant="secondary" className="font-normal">{dir.duty}</Badge>}
                    {dir.position && <Badge variant="secondary" className="font-normal">{dir.position}</Badge>}
                    {!dir.active && <Badge variant="destructive" className="font-normal">비활성(최근 명부에 없음)</Badge>}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">조직도 명부에 없는 이메일입니다. (외부 계정이거나 그룹웨어 이메일과 다름)</p>
              )}
            </Section>

            <Section icon={Activity} title="활동">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="가이드 질의" value={detail.activity.guide_questions ?? "—"} sub="누적" />
                <Stat label="내 팀 인원" value={detail.activity.team_members ?? "—"} sub="user_members" />
                <Stat
                  label="Claude Code 30일"
                  value={cc ? (cc.sessions > 0 || cc.cost_usd > 0 ? `$${cc.cost_usd.toFixed(2)}` : "없음") : "—"}
                  sub={cc && (cc.sessions > 0 || cc.cost_usd > 0) ? `세션 ${cc.sessions.toLocaleString()} · 프롬프트 ${cc.prompts.toLocaleString()} · ${cc.active_days}일` : cc ? `${cc.since} ~` : undefined}
                />
              </div>
            </Section>

            <Section icon={KeyRound} title={`개인 설정 (${detail.settings.length})`}>
              {detail.settings.length === 0 ? <p className="text-sm text-muted-foreground">없음</p> : (
                <KV rows={detail.settings.map((s) => [SETTING_LABEL[s.key] ?? s.key, s.value ?? "—"] as [string, ReactNode])} />
              )}
            </Section>

            <Section icon={LogIn} title={`최근 로그인 (${detail.logins.length})`}>
              {detail.logins.length === 0 ? <p className="text-sm text-muted-foreground">기록 없음</p> : (
                <ul className="divide-y text-sm">
                  {detail.logins.map((r, i) => {
                    const f = loginFields(r);
                    return (
                      <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="tabular-nums">{f.at}</span>
                        <span className="min-w-0 truncate text-right text-xs text-muted-foreground">{f.ip} · {f.ua}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-destructive"><AlertTriangle className="h-3.5 w-3.5" />위험 구역</h3>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                프로필·개인 설정·내 팀·로그인 이력·가이드 질의 기록을 삭제하고 로그인 계정도 제거합니다. 같은 계정으로 다시 로그인하면 <b>게스트</b>로 새로 생성됩니다. Claude 사용량 통계(이메일 기준)는 남습니다.
              </p>
              {detail.isSelf && <p className="mt-1 text-xs text-muted-foreground">자기 자신은 삭제할 수 없습니다.</p>}
              {!detail.isSelf && p.role === "admin" && <p className="mt-1 text-xs text-muted-foreground">관리자 계정은 먼저 역할을 &apos;사용자&apos;로 바꾼 뒤 삭제할 수 있습니다.</p>}
              <Button variant="destructive" size="sm" className="mt-3" disabled={!canDelete || busy} onClick={() => setConfirmOpen(true)}>
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
