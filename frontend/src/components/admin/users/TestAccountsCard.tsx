"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, FlaskConical, Loader2 } from "lucide-react";

interface Account {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  disabled: boolean;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short", hourCycle: "h23" });
}

/**
 * /admin/users의 "테스트 계정" 카드 — 애플 심사·공개 테스트용 이메일 계정(일반 사용자 권한).
 * 비밀번호는 생성·재설정 응답으로 한 번만 받아 이 화면에서만 보여 준다(저장하지 않는다). 런북 docs/test-accounts.md
 */
export default function TestAccountsCard({ onChanged }: { onChanged?: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/admin/test-accounts");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "테스트 계정 목록을 불러올 수 없습니다.");
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const call = async (key: string, url: string, init: RequestInit) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "요청에 실패했습니다.");
      if (data.password) {
        setSecret({ email: data.account?.email ?? "", password: data.password });
        setCopied(false);
      }
      await load();
      onChanged?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await call("create", "/api/admin/test-accounts", { method: "POST", body: JSON.stringify({ email, displayName: name, password: password || undefined }) });
    if (ok) { setEmail(""); setName(""); setPassword(""); }
  };
  const patch = (a: Account, action: "reset_password" | "disable" | "enable") =>
    call(`${action}:${a.id}`, `/api/admin/test-accounts/${a.id}`, { method: "PATCH", body: JSON.stringify({ action }) });
  const remove = async (a: Account) => {
    if (await call(`delete:${a.id}`, `/api/admin/test-accounts/${a.id}`, { method: "DELETE" })) setConfirmDelete(null);
  };

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.password);
      setCopied(true);
    } catch {
      setError("복사하지 못했습니다. 직접 선택해 복사하세요.");
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">테스트 계정</CardTitle>
          <Badge variant="secondary" className="text-xs">{accounts.length}개</Badge>
        </div>
        <CardDescription>애플 심사·공개 테스트용 이메일 로그인 계정입니다. 권한은 일반 사용자와 같고, 로그인 화면의 &quot;테스트 계정으로 로그인&quot;으로 들어옵니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {secret && (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">{secret.email} 비밀번호 — 이 화면을 벗어나면 다시 볼 수 없습니다.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="select-all rounded bg-white px-2 py-1 font-mono text-sm" aria-label="새 비밀번호">{secret.password}</code>
              <Button type="button" size="sm" variant="outline" onClick={copy}>
                {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}{copied ? "복사됨" : "복사"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setSecret(null)}>닫기</Button>
            </div>
          </div>
        )}

        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" aria-label="테스트 계정 이메일" className="h-8 w-56 text-xs" />
          <Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="이름(예: Apple Review)" aria-label="테스트 계정 이름" className="h-8 w-44 text-xs" />
          <Input type="text" autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호(비우면 자동 생성, 12자 이상)" aria-label="테스트 계정 비밀번호" className="h-8 w-64 text-xs" />
          <Button type="submit" size="sm" disabled={busy === "create"}>
            {busy === "create" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}추가
          </Button>
        </form>

        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />로딩 중...</div>
        ) : accounts.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">테스트 계정이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">계정</th>
                  <th className="px-2 py-2 font-medium">생성</th>
                  <th className="px-2 py-2 font-medium">최근 로그인</th>
                  <th className="px-2 py-2 font-medium">상태</th>
                  <th className="px-2 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b last:border-0" aria-label={`테스트 계정 ${a.email}`}>
                    <td className="px-2 py-2">
                      <p className="font-medium">{a.name || a.email}</p>
                      <p className="text-[11px] text-muted-foreground">{a.email}</p>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-muted-foreground">{fmt(a.created_at)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-muted-foreground">{fmt(a.last_sign_in_at)}</td>
                    <td className="px-2 py-2">
                      <Badge variant={a.disabled ? "outline" : "secondary"} className="text-xs">{a.disabled ? "비활성" : "사용 중"}</Badge>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        {confirmDelete === a.id ? (
                          <>
                            <span className="self-center text-xs text-destructive">삭제하면 되돌릴 수 없습니다.</span>
                            <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => remove(a)}>삭제 확인</Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>취소</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => patch(a, "reset_password")}>비밀번호 재설정</Button>
                            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => patch(a, a.disabled ? "enable" : "disable")}>{a.disabled ? "재활성화" : "비활성화"}</Button>
                            <Button size="sm" variant="ghost" className="text-destructive" disabled={!!busy} onClick={() => setConfirmDelete(a.id)}>삭제</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
