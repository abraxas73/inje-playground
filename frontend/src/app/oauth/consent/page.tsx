"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { ACCESS_SUMMARY, describeScopes, loopbackWarning, redirectAllowed, redirectHost } from "@/lib/mcp/consent";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; details: OAuthAuthorizationDetails } | { kind: "busy"; details: OAuthAuthorizationDetails };

/** Supabase OAuth 2.1 서버의 동의 화면 — Supabase가 ?authorization_id=… 로 보낸다(스펙 §5.2). */
export default function OAuthConsentPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const id = new URLSearchParams(window.location.search).get("authorization_id");
    if (!id) return setState({ kind: "error", message: "인가 요청 정보(authorization_id)가 없습니다." });
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
    if (error || !data) return setState({ kind: "error", message: error?.message ?? "인가 요청을 불러오지 못했습니다." });
    if ("redirect_url" in data) return window.location.assign(data.redirect_url); // 이미 동의한 클라이언트
    setState({ kind: "ready", details: data });
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 한 번 불러오기(외부 API)
    void load();
  }, [load]);

  const decide = async (approve: boolean) => {
    if (state.kind !== "ready") return;
    const { details } = state;
    setState({ kind: "busy", details });
    const oauth = createClient().auth.oauth;
    const { data, error } = approve
      ? await oauth.approveAuthorization(details.authorization_id, { skipBrowserRedirect: true })
      : await oauth.denyAuthorization(details.authorization_id, { skipBrowserRedirect: true });
    if (error || !data) return setState({ kind: "error", message: error?.message ?? "처리하지 못했습니다." });
    window.location.assign(data.redirect_url);
  };

  const details = state.kind === "ready" || state.kind === "busy" ? state.details : null;
  const warning = details ? loopbackWarning(details.redirect_uri) : null;
  const allowed = details ? redirectAllowed(details.redirect_uri) : false;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Claude를 INNOGRID 계정에 연결</CardTitle>
          {details && <CardDescription>{details.client.name}이(가) 다음 정보에 접근하려 합니다</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {state.kind === "loading" && <p className="text-muted-foreground">요청을 확인하는 중…</p>}
          {state.kind === "error" && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-destructive">{state.message}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                다시 시도
              </Button>
            </div>
          )}
          {details && (
            <>
              <ul className="list-disc pl-5 space-y-1">
                {describeScopes(details.scope.split(" ").filter(Boolean)).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className="text-muted-foreground">{ACCESS_SUMMARY}</p>
              <p className="text-muted-foreground">
                허용하면 <span className="font-medium text-foreground">{redirectHost(details.redirect_uri)}</span>(으)로 돌아갑니다.
              </p>
              {!allowed && (
                <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive">
                  Claude(claude.ai·claude.com)나 이 PC가 아닌 주소로 돌아가는 요청입니다. 허용할 수 없습니다. 이 링크를 보낸 곳을 관리자에게 알려 주세요.
                </p>
              )}
              {details.user?.email && <p className="text-muted-foreground">로그인 계정: {details.user.email}</p>}
              {warning && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">{warning}</p>}
            </>
          )}
        </CardContent>
        {details && (
          <CardFooter className="justify-end gap-2">
            <Button variant="outline" disabled={state.kind === "busy"} onClick={() => void decide(false)}>
              거부
            </Button>
            <Button disabled={state.kind === "busy" || !allowed} onClick={() => void decide(true)}>
              허용
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
