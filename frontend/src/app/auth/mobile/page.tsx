"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase";
import { safeNextPath } from "@/lib/mobile/next-path";

/**
 * 모바일 앱의 WebView가 처음 열 때 들어오는 페이지. 앱이 /api/mobile/web-token으로 받은 일회용 토큰을
 * URL 조각(#token=)으로 넘기면 여기서 verifyOtp로 쿠키 세션을 만들고 next로 이동한다.
 * 조각은 서버·Referer·감사 로그에 남지 않는다. 전체 새로고침으로 이동해 미들웨어가 새 쿠키를 보게 한다.
 */
function MobileAuth() {
  const sp = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const next = safeNextPath(sp.get("next"));
      const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      await Promise.resolve(); // 상태 변경은 effect 본문 밖(비동기)에서
      if (!token) { if (alive) setError("세션 토큰이 없습니다. 앱에서 다시 열어 주세요."); return; }
      const { error: e } = await createClient().auth.verifyOtp({ token_hash: token, type: "email" });
      if (!alive) return;
      if (e) setError(`세션을 만들지 못했습니다: ${e.message}`);
      else window.location.replace(next);
    };
    void run();
    return () => { alive = false; };
  }, [sp]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      {error ? <Alert variant="destructive" className="max-w-md"><AlertDescription>{error}</AlertDescription></Alert>
        : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />로그인 상태를 준비하고 있습니다…</div>}
    </div>
  );
}

export default function MobileAuthPage() {
  return <Suspense fallback={null}><MobileAuth /></Suspense>;
}
