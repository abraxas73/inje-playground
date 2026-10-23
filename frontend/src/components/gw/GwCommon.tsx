"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

const TABS = [{ href: "/gw/approvals", label: "결재" }, { href: "/gw/today", label: "일정" }, { href: "/gw/mail", label: "메일" }];

/** 웹 아마란스 세 화면(결재·일정·메일)을 오가는 탭 — 모두 메뉴에는 숨긴 화면이다. */
export function GwTabs() {
  const path = usePathname();
  return <nav aria-label="아마란스 화면" className="flex gap-1 border-b">
    {TABS.map((t) => <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}
      className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${path === t.href ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t.label}</Link>)}
  </nav>;
}

/** 데스크톱 앱 미실행(409 no_app) 안내 — 결재·일정·메일 공용. */
export function NoAppNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="rounded-xl border bg-card p-5 text-sm">
    <p role="status" className="font-medium">데스크톱 앱이 실행 중이 아닙니다.</p>
    <p className="mt-1 text-muted-foreground">{message}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <Button asChild><Link href="/apps">데스크톱 앱 받기</Link></Button>
      <Button variant="outline" onClick={onRetry}>다시 확인</Button>
      <Link href="/manual#gw-mail" className="self-center text-sm font-medium text-primary hover:underline">사용 안내</Link>
    </div>
  </div>;
}
