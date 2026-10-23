"use client";
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 화면을 그리다 예외가 나면 Next 기본 영어 페이지 대신 이 안내(상단 메뉴는 그대로 남는다). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[page-error]", error.digest ?? "", error.message); }, [error]);
  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border bg-card p-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" aria-hidden="true" />
      <h1 className="text-lg font-semibold">화면을 표시하지 못했습니다</h1>
      <p className="text-sm text-muted-foreground">일시적인 문제일 수 있습니다. 다시 시도해도 계속되면 관리자에게 알려 주세요.</p>
      {error.digest && <p className="text-xs text-muted-foreground">오류 번호: {error.digest}</p>}
      <div className="flex justify-center gap-2">
        <Button onClick={reset}><RefreshCw className="mr-1 h-4 w-4" />다시 시도</Button>
        <Button asChild variant="outline"><Link href="/">홈으로</Link></Button>
      </div>
    </div>
  );
}
