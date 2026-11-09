"use client";

import { DesktopDownloads } from "./DesktopDownloads";
import { useCallback, useEffect, useState } from "react";
import { Apple, Download, Plug, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ANDROID_PLAY_URL, IOS_APP_STORE_URL } from "@/lib/mobile/release";
import { useIosApp } from "@/lib/mobile/use-ios-app";
import { Button } from "@/components/ui/button";

type Platform = { version: string; build: number; releasedAt: string | null; url: string | null } | null;
type Release = { notes: string; ios: Platform; android: Platform };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }) : "");
const label = (p: Platform) => (p ? `v${p.version} (${p.build})` : "준비 중");
async function fetchRelease(): Promise<Release> {
  const res = await fetch("/api/mobile/release");
  const j = (await res.json().catch(() => ({}))) as Release & { error?: string };
  if (!res.ok) throw new Error(j.error ?? "버전 정보를 불러오지 못했습니다.");
  return j;
}

export function AppsPageView() {
  const iosApp = useIosApp();
  const [rel, setRel] = useState<Release | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setRel(await fetchRelease()); } catch (e) { setError(e instanceof Error ? e.message : "버전 정보를 불러오지 못했습니다."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">앱 설치·다운로드</h1>
        <p className="text-sm text-muted-foreground">이노크루 앱을 Mac, Windows PC 또는 휴대폰에 설치하세요. 사내 구성원용 앱입니다.</p>
      </div>
      <DesktopDownloads />
      <Card id="mcp" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plug className="h-5 w-5" /> Claude 커넥터</CardTitle>
          <CardDescription>
            claude.ai·Claude Desktop·Claude Code에서 <b>INNOGRID 아마란스</b> 커넥터를 연결하면 아마란스(메일·결재·일정·회의실·근태·게시판·조직도) 도구를 Claude가 쓸 수 있습니다. 실제 실행은 <b>이 PC의 INNOGRID 데스크탑 앱</b>이 맡습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>위 데스크탑 앱을 설치하고 로그인한 뒤 <b>더보기 &gt; 아마란스</b>에서 연결합니다.</li>
            <li>claude.ai <b>맞춤 설정 &gt; 커넥터 &gt; 내 항목</b>에서 &quot;INNOGRID 아마란스&quot; <b>연결</b>을 누르고 INNOGRID 계정으로 로그인·허용합니다.</li>
            <li>Claude에게 요청합니다(예: &quot;내 오늘 일정 알려줘&quot;). 앱이 꺼져 있으면 Claude가 &quot;데스크탑 앱이 실행 중이 아닙니다&quot;라고 알려 줍니다.</li>
          </ol>
          <p className="text-sm text-muted-foreground">쓰기 도구(메일 발송·결재 상신 등)도 열려 있으니 Claude의 도구 승인 프롬프트를 확인하고 쓰세요.</p>
        </CardContent>
      </Card>
      <h2 className="text-xl font-semibold">모바일 앱</h2>
      {!iosApp && <p className="text-sm text-muted-foreground">iPhone은 App Store, Android는 Google Play에서 신청 없이 바로 설치합니다.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} <Button variant="link" size="sm" onClick={load}>다시 시도</Button>
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Apple className="h-5 w-5" /> iPhone</CardTitle>
            <CardDescription>App Store에서 설치하고 업데이트합니다. 신청은 필요 없습니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>iPhone에서 아래 버튼으로 App Store의 <b>INNOCREW</b> 앱 페이지를 엽니다. 사내 전용(비공개) 앱이라 App Store 검색에는 나오지 않습니다.</li>
              <li><b>받기</b>를 누르고, 앱에서 회사 Microsoft 계정으로 로그인합니다.</li>
            </ol>
            <Button asChild><a href={IOS_APP_STORE_URL} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />App Store에서 설치</a></Button>
            <p className="text-xs text-muted-foreground">TestFlight로 쓰던 분도 App Store에서 받으면 같은 앱으로 바뀌며 로그인은 다시 해야 할 수 있습니다.</p>
          </CardContent>
        </Card>
        {!iosApp && <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Android</CardTitle>
            <CardDescription>Google Play에서 설치하고 업데이트합니다. 신청은 필요 없습니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>아래 버튼으로 Google Play의 <b>이노크루</b> 앱 페이지를 엽니다.</li>
              <li><b>설치</b>를 누르고, 앱에서 회사 Microsoft 계정으로 로그인합니다.</li>
            </ol>
            <Button asChild><a href={rel?.android?.url ?? ANDROID_PLAY_URL} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />Google Play에서 설치{rel?.android ? ` · ${label(rel.android)}` : ""}</a></Button>
          </CardContent>
        </Card>}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">현재 버전</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {loading && !rel ? (
            <p role="status" className="text-muted-foreground">불러오는 중…</p>
          ) : (
            <>
              <p>iPhone {label(rel?.ios ?? null)}{rel?.ios?.releasedAt ? ` · ${fmtDate(rel.ios.releasedAt)}` : ""}</p>
              {!iosApp && <p>Android {label(rel?.android ?? null)}{rel?.android?.releasedAt ? ` · ${fmtDate(rel.android.releasedAt)}` : ""}</p>}
              {rel?.notes && <p className="whitespace-pre-line text-muted-foreground">{rel.notes}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AppsPage() {
  return <AppsPageView />;
}
