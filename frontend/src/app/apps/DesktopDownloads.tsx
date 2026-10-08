"use client";
import { useEffect, useState } from "react";
import { Apple, Monitor, Download } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { DesktopRelease } from "@/lib/desktop/release";
export function DesktopDownloads() {
  const [release, setRelease] = useState<DesktopRelease | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { let live = true;
    fetch("/api/desktop/release").then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(r => { if (live) setRelease(r); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, []);
  return <section id="desktop" aria-labelledby="desktop-title" className="space-y-4 scroll-mt-24">
    <h2 id="desktop-title" className="text-xl font-semibold">데스크톱 앱</h2>
    {error && <p role="alert" className="text-sm text-destructive">설치 파일 정보를 불러오지 못했습니다. 페이지를 새로고침해 주세요.</p>}
    <div className="grid gap-4 md:grid-cols-2">
      {(["macos", "windows"] as const).map(platform => {
        const mac = platform === "macos", artifact = release?.[platform];
        return <Card key={platform}><CardHeader>
          <CardTitle className="flex items-center gap-2">{mac ? <Apple className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}{mac ? "macOS" : "Windows"}</CardTitle>
          <CardDescription>{mac ? "macOS 12 이상 · Apple Silicon / Intel" : "Windows 10 1809 이상 / 11 · x64 · 내부 테스트용"}</CardDescription>
        </CardHeader><CardContent className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">{mac ? <>
            <li>DMG를 열고 INNOGRID를 Applications 폴더로 옮깁니다.</li>
            <li>응용 프로그램에서 실행하고 Microsoft 계정으로 로그인합니다.</li>
          </> : <>
            <li>설치 프로그램을 실행하고 시작 메뉴에서 INNOGRID를 엽니다.</li>
            <li>웹 화면 실행에 Microsoft Edge WebView2 Runtime이 필요합니다.</li>
            <li>Microsoft 계정으로 로그인한 뒤 앱 열기를 허용합니다.</li>
          </>}</ol>
          {artifact ? <>
            <Button asChild><a href={`/api/desktop/download/${platform}`}><Download className="h-4 w-4" />{mac ? "DMG 다운로드" : "설치 파일 다운로드"} · {artifact.version}</a></Button>
            <p className="text-xs text-muted-foreground">{(artifact.bytes / 1024 / 1024).toFixed(1)} MB · {mac ? "Apple 서명·공증 완료" : "코드 서명 전 테스트 빌드 · Windows 보안 경고가 표시될 수 있습니다."}</p>
            <details className="text-xs text-muted-foreground"><summary>파일 검증 SHA-256</summary><code className="mt-2 block break-all">{artifact.sha256}</code></details>
          </> : <Button disabled>{error ? "정보 불러오기 실패" : release ? "설치 파일 준비 중" : "불러오는 중…"}</Button>}
        </CardContent></Card>;
      })}
    </div>
    <p className="text-sm text-muted-foreground">데스크톱 업데이트는 이 페이지에서 새 설치 파일을 받아 설치합니다. iPhone·Android 테스트 신청과는 별도로 설치할 수 있습니다.</p>
  </section>;
}
