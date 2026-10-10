"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Monitor, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { browserPlatform, dismissed, DISMISS_KEY, type Presence } from "@/lib/desktop/presence";
import type { DesktopPlatform } from "@/lib/desktop/release";

/** 데스크톱 브라우저에서, 이 계정으로 현재 OS의 앱에 로그인한 기록이 없을 때만 홈 맨 위에 설치를 권한다. */
export default function DesktopAppCard() {
  const { userId, canAccessPage } = useUserRole();
  return userId && canAccessPage("/apps") ? <Prompt key={userId} /> : null;
}

function Prompt() {
  const [platform, setPlatform] = useState<DesktopPlatform | null>(null);
  useEffect(() => {
    const p = browserPlatform(navigator.userAgent, navigator.maxTouchPoints);
    if (!p) return;
    try { if (dismissed(localStorage.getItem(DISMISS_KEY))) return; } catch { /* 저장소 차단 — 카드는 그대로 보여 준다 */ }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/desktop/presence", { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as Partial<Presence>;
        if (active && data[p] === null) setPlatform(p);
      } catch { /* 조회 실패면 카드를 띄우지 않는다 */ } finally { clearTimeout(timer); }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, []);
  if (!platform) return null;
  const mac = platform === "macos";
  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* 저장 못 해도 이번엔 닫는다 */ }
    setPlatform(null);
  };
  return <section aria-labelledby="desktop-app-title" className="mb-8 rounded-xl border border-primary/30 bg-primary/5 p-5 md:p-6">
    <div className="flex items-start justify-between gap-3">
      <h2 id="desktop-app-title" className="flex items-center gap-2 font-semibold"><Monitor aria-hidden="true" className="h-5 w-5 text-primary" />INNOGRID 데스크톱 앱을 설치하세요</h2>
      <Button variant="ghost" size="icon" aria-label="다음에" title="30일 동안 보지 않기" onClick={close}><X className="h-4 w-4" /></Button>
    </div>
    <p className="mt-1 text-sm text-muted-foreground">{mac ? "Mac" : "Windows"}에서 이 계정으로 앱에 로그인한 기록이 없습니다. 설치하면 이런 점이 좋습니다.</p>
    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
      <li>아마란스 메신저에서 나를 언급한 메시지를 PC 알림으로 바로 받습니다.</li>
      <li>claude.ai의 ‘INNOGRID 아마란스’ 커넥터로 메일·일정·회의실·결재를 처리할 수 있습니다. 이 앱이 켜져 있어야 요청이 실행됩니다.</li>
      <li>홈 브리핑과 비서 이노봇을 큰 화면에서 씁니다.</li>
    </ul>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button asChild><Link href="/apps">{mac ? "Mac" : "Windows"} 설치 파일 받기</Link></Button>
      <Link href="/manual#desktop-install" className="text-sm font-medium text-primary hover:underline">설치 안내 보기</Link>
      {!mac && <span className="text-xs text-muted-foreground">‘Windows의 PC 보호’ 창이 뜨면 추가 정보 → 실행</span>}
    </div>
  </section>;
}
