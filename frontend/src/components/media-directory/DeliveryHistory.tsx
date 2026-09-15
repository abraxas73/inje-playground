"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { MediaDelivery } from "@/types/media-directory";
const when = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export default function DeliveryHistory() {
  const [rows, setRows] = useState<MediaDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/media-directory/deliveries", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error); return body.deliveries as MediaDelivery[]; })
      .then((list) => { if (!controller.signal.aborted) setRows(list); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "발송 이력을 불러오지 못했습니다."); });
    return () => controller.abort();
  }, []);
  return (
    <Card><CardContent className="space-y-2 pt-5">
      <h2 className="font-semibold">최근 알림 발송 이력</h2>
      <p className="text-xs text-muted-foreground">수집 run마다 새 매칭이 있을 때 구독자별 1건. 실패는 자동 재발송하지 않습니다.</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : !rows ? <p className="text-sm text-muted-foreground">불러오는 중…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">아직 발송 이력이 없습니다.</p> : (
        <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 font-medium">시각</th><th className="py-1 font-medium">수신자</th><th className="py-1 font-medium">건수</th><th className="py-1 font-medium">결과</th></tr></thead>
          <tbody className="divide-y">{rows.map((d) => <tr key={d.id}><td className="py-1.5">{when.format(new Date(d.created_at))}</td><td className="py-1.5">{d.recipient_email}</td><td className="py-1.5">{d.match_count}</td><td className={`py-1.5 ${d.status === "failed" ? "text-destructive" : ""}`}>{d.status === "sent" ? "발송" : `실패${d.error_message ? ` · ${d.error_message}` : ""}`}</td></tr>)}</tbody></table>
      )}
    </CardContent></Card>
  );
}
