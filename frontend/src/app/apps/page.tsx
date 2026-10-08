"use client";

import { DesktopDownloads } from "./DesktopDownloads";
import { useCallback, useEffect, useState } from "react";
import { Apple, Download, Loader2, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

/**
 * 모바일 앱 설치 안내(사내 전용, 스토어 미게시). iPhone은 TestFlight 공개 링크, Android는 Google Play 내부 테스트 링크.
 * 새 버전은 iOS는 TestFlight가, Android는 앱 안 배너가 알려 준다. 런북 docs/mobile-app.md §배포.
 */
export function AppsPageView({ navigate = (url: string) => window.location.assign(url) }: { navigate?: (url: string) => void }) {
  const [rel, setRel] = useState<Release | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setRel(await fetchRelease()); } catch (e) { setError(e instanceof Error ? e.message : "버전 정보를 불러오지 못했습니다."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const openPlay = async () => {
    setBusy(true);
    setError(null);
    try {
      const fresh = await fetchRelease();
      if (!fresh.android?.url) throw new Error("Google Play 링크를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      navigate(fresh.android.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Google Play 링크를 불러오지 못했습니다."); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">앱 설치·다운로드</h1>
        <p className="text-sm text-muted-foreground">이노크루 앱을 Mac, Windows PC 또는 휴대폰에 설치하세요. 사내 구성원용 앱입니다.</p>
      </div>
      <DesktopDownloads />
      <h2 className="text-xl font-semibold">모바일 앱</h2>
      <p className="text-sm text-muted-foreground">iPhone·Android는 먼저 설정에서 앱 사용을 신청하고 초대를 수락해 주세요.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} <Button variant="link" size="sm" onClick={load}>다시 시도</Button>
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Apple className="h-5 w-5" /> iPhone</CardTitle>
            <CardDescription>TestFlight로 설치합니다. 새 버전은 자동으로 받습니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>App Store에서 <b>TestFlight</b> 앱을 설치합니다.</li>
              <li>아래 버튼을 누르고 TestFlight에서 <b>설치</b>를 누릅니다.</li>
            </ol>
            {rel?.ios?.url ? (
              <Button asChild><a href={rel.ios.url} target="_blank" rel="noreferrer">TestFlight에서 열기 · {label(rel.ios)}</a></Button>
            ) : (
              <Button disabled>TestFlight 준비 중</Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Android</CardTitle>
            <CardDescription>Google Play 내부 테스트로 설치하고 업데이트합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>내부 테스터로 등록된 Google 계정으로 로그인합니다.</li>
              <li>아래 버튼에서 테스트에 참여한 뒤 Google Play에서 <b>설치</b> 또는 <b>업데이트</b>를 누릅니다.</li>
            </ol>
            <Button onClick={openPlay} disabled={!rel?.android || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {rel?.android ? `Google Play에서 열기 · ${label(rel.android)}` : "Google Play 준비 중"}
            </Button>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">현재 버전</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {loading && !rel ? (
            <p role="status" className="text-muted-foreground">불러오는 중…</p>
          ) : (
            <>
              <p>iPhone {label(rel?.ios ?? null)}{rel?.ios?.releasedAt ? ` · ${fmtDate(rel.ios.releasedAt)}` : ""}</p>
              <p>Android {label(rel?.android ?? null)}{rel?.android?.releasedAt ? ` · ${fmtDate(rel.android.releasedAt)}` : ""}</p>
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
