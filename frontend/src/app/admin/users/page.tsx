"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Users, Shield, User, UserX } from "lucide-react";
import type { UserRoleInfo, UserRole } from "@/lib/roles";

const ROLE_CONFIG: Record<UserRole, { label: string; icon: typeof Shield; color: string }> = {
  admin: { label: "관리자", icon: Shield, color: "bg-red-100 text-red-700 border-red-200" },
  user: { label: "사용자", icon: User, color: "bg-blue-100 text-blue-700 border-blue-200" },
  guest: { label: "게스트", icon: UserX, color: "bg-gray-100 text-gray-600 border-gray-200" },
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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

  useEffect(() => {
    fetchUsers();
  }, []);

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

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {(["admin", "user", "guest"] as UserRole[]).map((r) => {
          const config = ROLE_CONFIG[r];
          const Icon = config.icon;
          return (
            <Card key={r}>
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

      {/* User List */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">사용자 목록</CardTitle>
            <Badge variant="secondary" className="text-xs ml-auto">
              {users.length}명
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="text-sm text-destructive mb-4">{error}</p>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">로딩 중...</span>
            </div>
          ) : (
            <div className="space-y-2">
              {users.map((u) => {
                const config = ROLE_CONFIG[u.role as UserRole] ?? ROLE_CONFIG.user;
                return (
                  <div
                    key={u.id}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {u.avatar_url ? (
                        <img
                          src={u.avatar_url}
                          alt=""
                          className="h-8 w-8 rounded-full shrink-0"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <User className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {u.display_name || u.email}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {u.email}
                        </p>
                        <p className="text-[11px] text-muted-foreground/70">
                          {u.last_login_at
                            ? `최근 로그인: ${new Date(u.last_login_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                            : "로그인 기록 없음"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {updatingId === u.user_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Select
                          value={u.role}
                          onValueChange={(val) => handleRoleChange(u.user_id, val as UserRole)}
                        >
                          <SelectTrigger className="w-[100px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">관리자</SelectItem>
                            <SelectItem value="user">사용자</SelectItem>
                            <SelectItem value="guest">게스트</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
