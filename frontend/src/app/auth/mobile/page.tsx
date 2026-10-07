"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase";
import { safeNextPath } from "@/lib/mobile/next-path";

/**
 * 모바일 앱의 WebView가 처음 열 때 들어오는 페이지. 앱이 /api/mobile/web-token으로 받은 일회용 토큰을
 * URL 조각(#token=)으로 넘기면 여기서 verifyOtp로 쿠키 세션을 만들고 next로 이동한다.
 * 조각은 서버·Referer·감사 로그에 남지 않는다. 전체 새로고침으로 이동해 미들웨어가 새 쿠키를 보게 한다.
 *
 * useSearchParams를 쓰지 않는 이유: Next는 history.replaceState(조각 제거)를 가로채 라우터를 갱신하고 그때 searchParams 객체가
 * 새로 만들어진다 — 그걸 effect 의존성으로 두면 조각이 사라진 뒤 effect가 다시 돌아 "토큰 없음"으로 덮어썼다(2026-10-03 시뮬레이터 재현).
 * 토큰이 없으면(새로고침·WebView 재로드) 오류 대신 next로 보낸다: 쿠키 세션이 이미 있으면 그대로 열리고, 없으면 /login으로 가 앱이 다시 부트스트랩한다.
 */
const defaultNavigate = (url: string) => window.location.replace(url);

export function MobileAuth({ navigate = defaultNavigate }: { navigate?: (url: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    // 1.3.10 앱도 이미 이 경로로 외부 브라우저 세션을 만든다. 앱 재빌드 없이 복귀 의도를 전달한다.
    const target = new URL(next, window.location.origin);
    if (["/api/ms/connect", "/api/jira/connect"].includes(target.pathname)) {
      target.searchParams.set("app_return", "1");
      next = target.pathname + target.search;
    }
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const run = async () => {
      await Promise.resolve(); // 상태 변경은 effect 본문 밖(비동기)에서
      if (!token) { navigate(next); return; }
      const { error: e } = await createClient().auth.verifyOtp({ token_hash: token, type: "email" });
      if (e) setError(`세션을 만들지 못했습니다: ${e.message}`);
      else navigate(next);
    };
    void run();
  }, [navigate]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      {error ? <Alert variant="destructive" className="max-w-md"><AlertDescription>{error}</AlertDescription></Alert>
        : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />로그인 상태를 준비하고 있습니다…</div>}
    </div>
  );
}

export default function MobileAuthPage() {
  return <MobileAuth />;
}
