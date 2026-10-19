"use client";

import { useSyncExternalStore } from "react";
import { homeGreeting } from "@/lib/home";

const nowMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const serverMinute = () => 0;
function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 60_000);
  window.addEventListener("focus", onChange);
  return () => { clearInterval(timer); window.removeEventListener("focus", onChange); };
}

export default function DailyGreeting() {
  const time = useSyncExternalStore(subscribe, nowMinute, serverMinute);
  const greeting = time ? homeGreeting(new Date(time)) : null;
  // 한 줄 배치(사용자 요청): 왼쪽 인사말·날짜, 오른쪽 오늘의 한 줄. 좁은 화면에서는 두 줄로 내려간다.
  return <section aria-label="오늘의 인사" className="mb-4 flex flex-col gap-x-6 gap-y-1 rounded-xl border bg-card px-4 py-3 md:flex-row md:items-center">
    <div className="shrink-0">
      <h2 className="text-lg font-semibold">{greeting?.title ?? "이노크루, 반가워요"}</h2>
      <p className="text-xs text-muted-foreground">{greeting ? `${greeting.date} · ${greeting.subtitle}` : "오늘도 좋은 하루 보내세요"}</p>
    </div>
    {greeting && <blockquote className="min-w-0 text-sm md:border-l md:border-primary/30 md:pl-6">
      <span className="mr-2 text-xs font-medium text-primary">오늘의 한 줄</span>
      <span>{greeting.quote}</span>
      <span className="ml-2 text-xs text-muted-foreground">— 한국 속담</span>
    </blockquote>}
  </section>;
}
