"use client";
import Link from "next/link";

/** 루트 레이아웃까지 깨졌을 때의 마지막 안내 — 레이아웃·스타일이 없으므로 인라인 스타일만 쓴다. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 480, margin: "40px auto", lineHeight: 1.7, textAlign: "center" }}>
        <h1 style={{ fontSize: 20 }}>화면을 표시하지 못했습니다</h1>
        <p>일시적인 문제일 수 있습니다. 다시 시도해도 계속되면 관리자에게 알려 주세요.</p>
        {error.digest && <p style={{ fontSize: 12, color: "#666" }}>오류 번호: {error.digest}</p>}
        <button type="button" onClick={reset} style={{ padding: "8px 16px", marginRight: 8 }}>다시 시도</button>
        <Link href="/">홈으로</Link>
      </body>
    </html>
  );
}
