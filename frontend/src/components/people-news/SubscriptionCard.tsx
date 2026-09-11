"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useMsCallbackQuery } from "@/hooks/useMsCallbackQuery";

interface Subscription { enabled: boolean; send_time: string; next_send_at: string | null }
interface Settings {
  email: string | null;
  emailVerified: boolean;
  mailReady: boolean;
  connectedEmail: string | null;
  subscription: Subscription;
  latestDelivery: { status: "processing" | "sent" | "failed" | "cancelled"; finished_at: string | null } | null;
}
const format = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });

export default function SubscriptionCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [sendTime, setSendTime] = useState("07:10");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  useMsCallbackQuery({
    onConnected: () => setRetry((n) => n + 1),
    onError: (text) => setMessage({ text, error: true }),
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/people-news/subscription", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const result = await r.json(); if (!r.ok) throw new Error(result.error); return result as Settings; })
      .then((result) => {
        if (controller.signal.aborted) return;
        setSettings(result); setEnabled(result.subscription.enabled); setSendTime(result.subscription.send_time.slice(0, 5)); setMessage(null);
      })
      .catch((e) => { if (!controller.signal.aborted) setMessage({ text: e instanceof Error ? e.message : "수신 설정을 불러오지 못했습니다.", error: true }); });
    return () => controller.abort();
  }, [retry]);

  async function save() {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/people-news/subscription", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, sendTime }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "수신 설정을 저장하지 못했습니다.");
      setSettings((old) => old ? { ...old, subscription: result.subscription } : old);
      setMessage({ text: enabled ? `매일 ${sendTime}에 메일을 수신하도록 저장했습니다.` : "메일 수신을 해제했습니다.", error: false });
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "수신 설정을 저장하지 못했습니다.", error: true }); }
    finally { setSaving(false); }
  }

  async function sendNow() {
    setSending(true); setMessage(null);
    try {
      const response = await fetch("/api/people-news/email", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "메일 발송에 실패했습니다.");
      setMessage({ text: `최근 24시간 수집분 ${result.count}건의 메일 발송을 요청했습니다. 받은편지함을 확인해 주세요. 예약 시간은 유지됩니다.`, error: false });
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "메일 발송에 실패했습니다.", error: true }); }
    finally { setSending(false); }
  }

  async function showPreview() {
    setPreviewOpen(true); setPreview(null); setPreviewError(null);
    try {
      const response = await fetch("/api/people-news/email", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "미리보기를 불러오지 못했습니다.");
      setPreview(result);
    } catch (e) { setPreviewError(e instanceof Error ? e.message : "미리보기를 불러오지 못했습니다."); }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-sky-600" />메일로 소식 받기</h2>
            <p className="mt-1 text-xs text-muted-foreground">{settings?.email ?? "계정 이메일"}로 인사·부고 소식을 보내드립니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="notice-subscribe" checked={enabled} onCheckedChange={setEnabled} disabled={!settings || saving || (!enabled && (!settings.emailVerified || !settings.mailReady))} />
              <Label htmlFor="notice-subscribe">수신하기</Label>
            </div>
            <Label htmlFor="notice-send-time" className="sr-only">매일 수신 시간 (한국 시간)</Label>
            <Input id="notice-send-time" type="time" step={60} value={sendTime} onChange={(e) => setSendTime(e.target.value)} disabled={!settings || !enabled || saving} className="w-32" />
            <span className="text-xs text-muted-foreground">한국 시간</span>
            <Button size="sm" variant="outline" disabled={!settings || saving || !sendTime || (enabled && !settings.mailReady)} onClick={save}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}설정 저장
            </Button>
          </div>
        </div>
        {settings && !settings.mailReady && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>본인 이메일에서 발송하려면 {settings.email} Microsoft 계정을 연결하고 메일 발송에 동의해 주세요.</span>
          <Button asChild variant="outline" size="sm"><a href="/api/ms/connect?returnTo=%2Fpeople-news">Microsoft 메일 연결</a></Button>
          {settings.connectedEmail && <span>현재 연결: {settings.connectedEmail}</span>}
        </div>}
        {settings?.subscription.enabled && settings.subscription.next_send_at && <p className="text-xs text-muted-foreground">다음 발송 예정: {format(settings.subscription.next_send_at)}</p>}
        {settings?.latestDelivery?.status === "sent" && settings.latestDelivery.finished_at && <p className="text-xs text-muted-foreground">최근 발송: {format(settings.latestDelivery.finished_at)}</p>}
        {settings?.latestDelivery?.status === "failed" && <p className="text-xs text-destructive">최근 메일 발송에 실패했습니다. 관리자에게 문의해 주세요.</p>}
        {settings && !settings.emailVerified && <p className="text-xs text-destructive">계정 이메일 인증이 필요합니다.</p>}
        {message && <p role="status" className={`text-xs ${message.error ? "text-destructive" : "text-muted-foreground"}`}>{message.text}{!settings && <button className="ml-2 underline" onClick={() => setRetry((n) => n + 1)}>다시 시도</button>}</p>}
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>예약 수신: 첫 메일은 최근 24시간, 이후에는 마지막 예약 발송 성공 이후 새로 수집된 소식을 보냅니다. 기사 송고일이 아닌 수집 시각 기준이며, 화면의 검색·필터와 무관합니다.</p>
          <p>매일 오전 7시에 소식을 수집하며 기본 수신 시간은 오전 7시 10분입니다. 설정한 시간부터 순차적으로 발송합니다.</p>
          <p>지금 수신: 최근 24시간 수집분을 본인 Microsoft 이메일에서 본인에게 보냅니다. 예약 수신과 별개로 같은 소식이 다시 포함될 수 있습니다. 최신 소식이 필요하면 먼저 ‘지금 가져오기’를 눌러 주세요.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={sendNow} disabled={sending || !settings?.mailReady || !settings?.emailVerified}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}지금 수신
          </Button>
          <Button size="sm" variant="outline" onClick={showPreview}>메일 미리보기</Button>
        </div>
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="sm:max-w-3xl">
            <DialogTitle>메일 미리보기</DialogTitle>
            <DialogDescription>지금 수신할 최근 24시간 수집분입니다. 실제 발송과 같은 양식이며, 미리보기는 메일을 보내지 않습니다.</DialogDescription>
            {previewError ? <p role="alert" className="text-sm text-destructive">{previewError}</p> : preview ? <>
              <p className="text-sm font-medium">제목: {preview.subject}</p>
              <iframe title="인사·부고 이메일 본문" srcDoc={preview.html} sandbox="" className="h-[60vh] w-full rounded border bg-white" />
            </> : <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />메일을 불러오고 있습니다.</p>}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
