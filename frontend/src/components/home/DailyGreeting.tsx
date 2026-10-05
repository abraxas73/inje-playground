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
  return <section aria-label="오늘의 인사" className="mb-6 rounded-xl border bg-card p-5 md:p-6">
    <p className="mb-1 text-xs text-muted-foreground">{greeting?.date ?? "오늘의 인사"}</p>
    <h2 className="text-xl font-semibold">{greeting?.title ?? "이노크루, 반가워요"}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{greeting?.subtitle ?? "오늘도 좋은 하루 보내세요"}</p>
    {greeting && <blockquote className="mt-4 border-l-2 border-primary/40 pl-4 text-sm leading-relaxed">
      <p className="mb-1 text-xs font-medium text-muted-foreground">오늘의 한 줄</p>
      <p>{greeting.quote}</p><footer className="mt-1 text-xs text-muted-foreground">한국 속담</footer>
    </blockquote>}
  </section>;
}
