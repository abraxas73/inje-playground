"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { MediaAlertSettings } from "@/types/media-directory";
const format = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });

export default function MediaAlertCard() {
  const [settings, setSettings] = useState<MediaAlertSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/people-news/media-alerts", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error); return body as MediaAlertSettings; })
      .then((body) => { if (!controller.signal.aborted) setSettings(body); })
      .catch((e) => { if (!controller.signal.aborted) setMessage({ text: e instanceof Error ? e.message : "알림 설정을 불러오지 못했습니다.", error: true }); });
    return () => controller.abort();
  }, []);

  async function toggle(enabled: boolean) {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/people-news/media-alerts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "알림 설정을 저장하지 못했습니다.");
      setSettings((old) => (old ? { ...old, enabled: body.enabled, updatedAt: body.updatedAt } : old));
      setMessage({ text: body.enabled ? "알림을 켰습니다. 새 부고가 관리 매체·부서와 일치하면 메일을 보냅니다." : "알림을 꺼 두었습니다.", error: false });
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "알림 설정을 저장하지 못했습니다.", error: true }); }
    finally { setSaving(false); }
  }

  return (
    <Card><CardContent className="space-y-3 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><BellRing className="h-4 w-4 text-sky-600" />관리 매체·부서 부고 알림</h2>
          <p className="mt-1 text-xs text-muted-foreground">새로 수집된 부고가 <Link href="/media-directory" className="underline">관리 매체·부서</Link>와 일치하면 {settings?.email ?? "계정 이메일"}로 메일을 보냅니다. Microsoft 연결이 필요 없습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="media-alert" checked={settings?.enabled ?? false} disabled={!settings || saving || (!settings.enabled && !settings.emailVerified)} onCheckedChange={(checked) => void toggle(checked)} />
          <Label htmlFor="media-alert">관리 매체·부서 부고 알림 받기</Label>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      </div>
      {settings && !settings.emailVerified && <p className="text-xs text-destructive">계정 이메일 인증이 필요합니다.</p>}
      {settings?.latestDelivery?.status === "sent" && <p className="text-xs text-muted-foreground">최근 알림: {format(settings.latestDelivery.created_at)} · {settings.latestDelivery.match_count}건</p>}
      {settings?.latestDelivery?.status === "failed" && <p className="text-xs text-destructive">최근 알림 발송 실패 ({format(settings.latestDelivery.created_at)}){settings.latestDelivery.error_message ? ` · ${settings.latestDelivery.error_message}` : ""}. 관리자에게 문의해 주세요.</p>}
      {message && <p role="status" className={`text-xs ${message.error ? "text-destructive" : "text-muted-foreground"}`}>{message.text}</p>}
      <p className="text-xs text-muted-foreground">매일 07:00 수집과 ‘지금 가져오기’ 직후, 새 매칭이 있을 때만 수집 1회당 1통을 보냅니다. 매체와 등록 부서가 함께 나올 때만 일치하며 ‘부서 무관’ 매체는 매체명만으로 일치합니다.</p>
    </CardContent></Card>
  );
}
