"use client";
import { useEffect, useState } from "react";
import { Apple, BookOpen, Monitor, Download } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { DesktopRelease } from "@/lib/desktop/release";

const releaseDateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild><a href={`/api/desktop/download/${platform}`}><Download className="h-4 w-4" />{mac ? "DMG 다운로드" : "설치 파일 다운로드"} · {artifact.version}</a></Button>
              <time dateTime={artifact.releasedAt} className="text-xs text-muted-foreground">
                업데이트 게시: {releaseDateTime.format(new Date(artifact.releasedAt))} (KST)
              </time>
            </div>
            <p className="text-xs text-muted-foreground">{(artifact.bytes / 1024 / 1024).toFixed(1)} MB · {mac ? "Apple 서명·공증 완료" : <>코드 서명 전 테스트 빌드라 경고가 두 번 뜹니다. ① 다운로드할 때 ‘일반적으로 다운로드되지 않는 파일’ 경고 — Edge는 다운로드 목록의 ‘…’ → <strong>유지 → 그래도 유지</strong>, Chrome은 <strong>유지</strong>. ② 실행할 때 ‘Windows의 PC 보호’ 창 — <strong>추가 정보 → 실행</strong>.</>}</p>
            {!mac && <div role="note" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              <p><strong>설치 후 앱을 열 때 ‘app_links_plugin.dll … 잘못된 이미지’ 오류가 나면</strong> Windows 11의 스마트 앱 컨트롤이 서명 전 파일을 막은 것입니다. 시작 메뉴에서 <strong>스마트 앱 컨트롤</strong>을 검색해 <strong>끄기</strong>로 바꾼 뒤 앱을 다시 여세요(재설치 불필요).</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm"><a href="/manual#windows-smart-app-control"><BookOpen className="h-4 w-4" />실행 오류 화면 안내 보기</a></Button>
                <Button asChild size="sm" variant="outline"><a href="/manual#desktop-install"><BookOpen className="h-4 w-4" />설치 경고 화면 안내 보기</a></Button>
              </div>
            </div>}
            <details className="text-xs text-muted-foreground"><summary>파일 검증 SHA-256</summary><code className="mt-2 block break-all">{artifact.sha256}</code></details>
          </> : <Button disabled>{error ? "정보 불러오기 실패" : release ? "설치 파일 준비 중" : "불러오는 중…"}</Button>}
        </CardContent></Card>;
      })}
    </div>
    <p className="text-sm text-muted-foreground">1.7.9부터 앱 내 자동 업데이트를 지원합니다. 이전 버전은 이 페이지에서 최초 한 번 설치해 주세요. 이후 앱 상단의 업데이트 띠를 누르면 다운로드 후 자동 설치·재시작됩니다. 누르기 전에 작업을 저장해 주세요. iPhone·Android 테스트 신청과는 별도로 설치할 수 있습니다.</p>
  </section>;
}
