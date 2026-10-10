"use client";

import { DesktopDownloads } from "./DesktopDownloads";
import { useCallback, useEffect, useState } from "react";
import { Apple, Download, Loader2, Plug, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { REQUEST_STATUS, type AppRequest, type AppPlatform } from "@/lib/mobile/app-requests";
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

async function fetchRequests(): Promise<AppRequest[]> {
  const res = await fetch("/api/mobile/app-requests", { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || !Array.isArray(data.items)) throw new Error(data.error ?? "신청 상태를 불러오지 못했습니다.");
  return data.items;
}

export function AppsPageView({ navigate = (url: string) => window.location.assign(url) }: { navigate?: (url: string) => void }) {
  const [rel, setRel] = useState<Release | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<AppRequest[] | null>(null);
  const [requestLoading, setRequestLoading] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);
  const loadRequests = useCallback(async () => {
    setRequestLoading(true); setRequestError(null); setRequests(null);
    try { setRequests(await fetchRequests()); }
    catch (e) { setRequestError(e instanceof Error ? e.message : "신청 상태를 불러오지 못했습니다."); }
    finally { setRequestLoading(false); }
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setRel(await fetchRelease()); } catch (e) { setError(e instanceof Error ? e.message : "버전 정보를 불러오지 못했습니다."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); void loadRequests(); }, [load, loadRequests]);
  const openPlay = async () => {
    setBusy(true);
    setError(null);
    try {
      const current = await fetchRequests();
      setRequests(current);
      if (current.find(item => item.platform === "android")?.status !== "approved") {
        navigate("/settings#app-request"); return;
      }
      const fresh = await fetchRelease();
      if (!fresh.android?.url) throw new Error("Google Play 링크를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      navigate(fresh.android.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Google Play 링크를 불러오지 못했습니다."); } finally { setBusy(false); }
  };
  const applicationAction = (platform: AppPlatform) => {
    const item = requests?.find(x => x.platform === platform);
    const approved = item?.status === "approved";
    const title = requestError ? "신청 상태 확인" : !item ? (platform === "ios" ? "TestFlight 신청하기" : "앱 사용 신청하기")
      : item.status === "rejected" ? "다시 신청하기" : approved ? "TestFlight 설치 안내" : "신청 상태 확인";
    return <div className="space-y-3">
      <Badge variant={item?.status === "rejected" ? "destructive" : "secondary"}>{requestLoading ? "상태 확인 중" : requestError ? "상태 확인 필요" : item ? REQUEST_STATUS[item.status] : "미신청"}</Badge>
      {item && <p className="break-all text-xs text-muted-foreground">신청 계정: {item.store_email}</p>}
      <div>{requestLoading ? <Button disabled>신청 상태 확인 중…</Button>
        : platform === "android" && approved ? <Button onClick={openPlay} disabled={!rel?.android?.url || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {rel?.android?.url ? `Google Play에서 열기 · ${label(rel.android)}` : "Google Play 준비 중"}
        </Button> : <Button asChild><a href="/settings#app-request">{title}</a></Button>}</div>
      {approved && platform === "android" && <a href="/settings#app-request" className="block text-sm text-primary hover:underline">신청 상태 확인</a>}
    </div>;
  };
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
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
      <p className="text-sm text-muted-foreground">iPhone·Android는 먼저 설정에서 앱 사용을 신청하고 초대를 수락해 주세요.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} <Button variant="link" size="sm" onClick={load}>다시 시도</Button>
        </p>
      )}
      {requestError && <p role="alert" className="text-sm text-destructive">{requestError} <Button variant="link" size="sm" onClick={loadRequests}>신청 상태 다시 확인</Button></p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Apple className="h-5 w-5" /> iPhone</CardTitle>
            <CardDescription>TestFlight로 설치합니다. 새 버전은 자동으로 받습니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>App Store에서 <b>TestFlight</b> 앱을 설치합니다.</li>
              <li>아래 버튼에서 iOS 앱 사용을 신청하고, 초대를 수락한 뒤 TestFlight에서 <b>설치</b>를 누릅니다.</li>
            </ol>
            {applicationAction("ios")}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Android</CardTitle>
            <CardDescription>Google Play 내부 테스트로 설치하고 업데이트합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>앱 사용을 신청하고 등록 완료 후, 신청한 Google 계정으로 로그인합니다.</li>
              <li>등록 완료되면 아래 Google Play 버튼에서 테스트에 참여한 뒤 <b>설치</b> 또는 <b>업데이트</b>를 누릅니다.</li>
            </ol>
            {applicationAction("android")}
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
