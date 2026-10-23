"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, Loader2, Search, Shield, User, UserX, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole, UserRoleInfo } from "@/lib/roles";
import type { AppInstalls, AppPlatform } from "@/lib/desktop/presence";
import UserDetailSheet from "@/components/admin/users/UserDetailSheet";
import TestAccountsCard from "@/components/admin/users/TestAccountsCard";

interface Row extends UserRoleInfo {
  settings: Record<string, string>;
  /** 사내 조직도(company_directory) 조인 — 없으면 null */
  directory: { division: string | null; headquarters: string | null; team: string | null; duty: string | null; position: string | null } | null;
  /** 플랫폼별 마지막 앱 로그인(= 설치 현황), 출처 login_history 앱 User-Agent */
  installs: AppInstalls;
  /** 테스트 전용 이메일 계정(auth app_metadata.test_account) */
  test_account?: boolean;
}

const ROLE_CONFIG: Record<UserRole, { label: string; icon: typeof Shield; color: string }> = {
  admin: { label: "관리자", icon: Shield, color: "bg-red-100 text-red-700 border-red-200" },
  user: { label: "사용자", icon: User, color: "bg-blue-100 text-blue-700 border-blue-200" },
  guest: { label: "게스트", icon: UserX, color: "bg-gray-100 text-gray-600 border-gray-200" },
};
const PLATFORMS: { key: AppPlatform; label: string }[] = [
  { key: "ios", label: "iOS" }, { key: "android", label: "Android" }, { key: "windows", label: "Windows" }, { key: "macos", label: "Mac" },
];
type SortKey = "name" | "created_at" | "last_login_at";

/** ISO → `YYYY-MM-DD`(KST), time이면 ` HH:mm`까지. 값이 없거나 깨졌으면 null */
function fmtKst(iso: string | null | undefined, time = false): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}${time ? ` ${g("hour")}:${g("minute")}` : ""}`;
}

function orgOf(u: Row): { unit: string; title: string } | null {
  const d = u.directory;
  if (!d?.team) return null;
  const unit = [d.headquarters ?? d.division, d.team].filter((v, i, a) => v && a.indexOf(v) === i).join(" › ");
  return { unit, title: [d.duty, d.position].filter(Boolean).join("/") };
}

function matches(u: Row, q: string): boolean {
  if (!q) return true;
  const d = u.directory;
  return [u.display_name, u.email, d?.division, d?.headquarters, d?.team, d?.duty, d?.position]
    .filter(Boolean).join(" ").toLowerCase().includes(q);
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "created_at", desc: true });

  const fetchUsers = async () => {
    try {
      setError(null);
      const res = await fetch("/api/users");
      if (!res.ok) throw new Error("사용자 목록을 불러올 수 없습니다.");
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setUpdatingId(userId);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "역할 변경에 실패했습니다.");
        return;
      }
      await fetchUsers();
    } catch {
      alert("오류가 발생했습니다.");
    } finally {
      setUpdatingId(null);
    }
  };

  const roleCounts = {
    admin: users.filter((u) => u.role === "admin").length,
    user: users.filter((u) => u.role === "user").length,
    guest: users.filter((u) => u.role === "guest").length,
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = users.filter((u) => (roleFilter === "all" || u.role === roleFilter) && matches(u, needle));
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      if (sort.key === "name") return dir * (a.display_name || a.email).localeCompare(b.display_name || b.email, "ko");
      const av = a[sort.key] ?? "", bv = b[sort.key] ?? "";
      if (!av || !bv) return av ? -1 : bv ? 1 : 0; // 값 없는 행은 정렬 방향과 무관하게 맨 뒤
      return dir * av.localeCompare(bv);
    });
  }, [users, q, roleFilter, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));
  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn("px-2 py-2 font-medium", className)}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`${children} 정렬`}>
        {children}
        {sort.key === k && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <>
      {/* Stats — 누르면 그 역할만 본다 */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {(["admin", "user", "guest"] as UserRole[]).map((r) => {
          const config = ROLE_CONFIG[r];
          const Icon = config.icon;
          const active = roleFilter === r;
          return (
            <Card key={r} role="button" tabIndex={0} aria-pressed={active}
              onClick={() => setRoleFilter(active ? "all" : r)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRoleFilter(active ? "all" : r); } }}
              className={cn("cursor-pointer transition-colors hover:bg-muted/40", active && "ring-2 ring-ring")}>
              <CardContent className="flex items-center gap-3 py-4">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${config.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{roleCounts[r]}</p>
                  <p className="text-xs text-muted-foreground">{config.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">사용자 목록</CardTitle>
            <Badge variant="secondary" className="text-xs">{rows.length === users.length ? `${users.length}명` : `${rows.length} / ${users.length}명`}</Badge>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as UserRole | "all")}>
                <SelectTrigger className="h-8 w-28 text-xs" aria-label="역할 필터"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모든 역할</SelectItem>
                  <SelectItem value="admin">관리자</SelectItem>
                  <SelectItem value="user">사용자</SelectItem>
                  <SelectItem value="guest">게스트</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·이메일·소속·직책 검색" aria-label="사용자 검색" className="h-8 w-64 pl-7 text-xs" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive mb-4">{error}</p>}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">로딩 중...</span>
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{users.length ? "조건에 맞는 사용자가 없습니다." : "사용자가 없습니다."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <SortHead k="name">사용자</SortHead>
                    <th className="px-2 py-2 font-medium">소속</th>
                    <th className="px-2 py-2 font-medium">역할</th>
                    <SortHead k="created_at" className="whitespace-nowrap">가입일</SortHead>
                    <SortHead k="last_login_at" className="whitespace-nowrap">최근 로그인</SortHead>
                    <th className="px-2 py-2 font-medium">앱 설치(마지막 로그인 버전)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const org = orgOf(u);
                    const config = ROLE_CONFIG[u.role as UserRole] ?? ROLE_CONFIG.user;
                    return (
                      <tr key={u.id} tabIndex={0} aria-label={`${u.display_name || u.email} 상세 보기`}
                        onClick={() => setSelectedId(u.user_id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(u.user_id); } }}
                        className="cursor-pointer border-b last:border-0 align-middle transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {u.avatar_url ? (
                              <img src={u.avatar_url} alt="" className="h-7 w-7 shrink-0 rounded-full" />
                            ) : (
                              <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", config.color)}><User className="h-3.5 w-3.5" /></div>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {u.display_name || u.email}
                                {u.test_account && <Badge variant="outline" className="ml-1.5 border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-800">테스트</Badge>}
                              </p>
                              <p className="truncate text-[11px] text-muted-foreground">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {org ? (
                            <>
                              <div>{org.unit}</div>
                              {org.title && <div className="text-[11px] text-muted-foreground">{org.title}</div>}
                            </>
                          ) : <span className="text-muted-foreground/60">—</span>}
                        </td>
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          {updatingId === u.user_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Select value={u.role} onValueChange={(val) => handleRoleChange(u.user_id, val as UserRole)}>
                              <SelectTrigger className="h-7 w-[92px] text-xs" aria-label={`${u.display_name || u.email} 역할`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">관리자</SelectItem>
                                <SelectItem value="user">사용자</SelectItem>
                                <SelectItem value="guest">게스트</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-muted-foreground">{fmtKst(u.created_at) ?? "—"}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-muted-foreground">{fmtKst(u.last_login_at, true) ?? <span className="text-muted-foreground/60">기록 없음</span>}</td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1">
                            {PLATFORMS.map((p) => {
                              const i = u.installs?.[p.key];
                              return (
                                <span key={p.key} title={i ? `${p.label} ${i.version}${i.build != null ? ` (${i.build})` : ""} · 마지막 로그인 ${fmtKst(i.at, true)}` : `${p.label} 앱 로그인 기록 없음`}
                                  className={cn("rounded border px-1.5 py-0.5 text-[11px] tabular-nums whitespace-nowrap", i ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-dashed text-muted-foreground/50")}>
                                  {p.label} {i ? i.version : "–"}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <TestAccountsCard onChanged={fetchUsers} />
      <UserDetailSheet userId={selectedId} onClose={() => setSelectedId(null)} onChanged={fetchUsers} />
    </>
  );
}
