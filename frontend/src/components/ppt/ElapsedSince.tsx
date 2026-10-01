"use client";
import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/ppt/elapsed";

/** since(ISO)부터 지금까지를 1초마다 다시 그린다. 생성 중 표시 전용 */
export default function ElapsedSince({ since }: { since: string }) {
  const start = new Date(since).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{formatElapsed(now - start)}</span>;
}
