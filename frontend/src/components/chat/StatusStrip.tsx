"use client";

import Link from "next/link";

export type ChatStatus = { desktop: boolean; microsoft: boolean; atlassian: boolean } | null;
const Dot = ({ on, label }: { on: boolean | null; label: string }) => (
  <span className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${on === null ? "bg-muted-foreground/40 animate-pulse" : on ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />{label}</span>
);

/** 상단 연결 상태 띠 — 데스크톱 앱이 꺼져 있으면 아마란스가 안 된다는 것을 미리 알린다. */
export default function StatusStrip({ status }: { status: ChatStatus }) {
  return (
    <div className="space-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Dot on label="Teams·Confluence·SharePoint" />
        <Dot on={status ? status.desktop : null} label={status ? (status.desktop ? "데스크톱 앱 켜짐" : "데스크톱 앱 꺼짐") : "데스크톱 앱 확인 중"} />
        <Dot on={status ? status.microsoft : null} label="Microsoft" />
        <Dot on={status ? status.atlassian : null} label="Atlassian" />
      </div>
      {status && !status.desktop && <p>아마란스 메일·결재는 데스크톱 앱이 켜져 있어야 합니다. <Link href="/apps" className="text-primary hover:underline">앱 받기</Link></p>}
      {status && (!status.microsoft || !status.atlassian) && <p>연결이 꺼진 서비스는 <Link href="/settings" className="text-primary hover:underline">설정</Link>에서 연결하세요.</p>}
    </div>
  );
}
