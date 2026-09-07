"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Check, Loader2, Send, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

/**
 * 개인 설정: 내 알림이 갈 채널(Teams 워크플로우 트리거 URL).
 * 저장하면 내가 만든 알림(RFP SharePoint 업로드·팀 구성 결과)이 전역 채널 대신 이 채널로 간다.
 */
export default function NotifyChannelCard() {
  const [url, setUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users/notify-channel");
      if (!res.ok) throw new Error(await readError(res, "설정을 불러오지 못했습니다."));
      const j = (await res.json()) as { url: string };
      setUrl(j.url);
      setSavedUrl(j.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "설정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/users/notify-channel", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok) throw new Error(await readError(res, "저장하지 못했습니다."));
      setSavedUrl(((await res.json()) as { url: string }).url);
      setNotice("저장했습니다. “테스트 전송”으로 확인해 보세요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/users/notify-channel", { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(await readError(res, "해제하지 못했습니다."));
      setUrl("");
      setSavedUrl("");
      setNotice("해제했습니다. 이제 관리자가 설정한 채널로 갑니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "해제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/users/notify-channel", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { error?: string; personal?: boolean };
      if (!res.ok) throw new Error(j.error ?? "발송에 실패했습니다.");
      setNotice(j.personal ? "내 워크플로우로 테스트 메시지를 보냈습니다." : "개인 URL이 없어 관리자가 설정한 채널로 보냈습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "발송에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const dirty = url.trim() !== savedUrl;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4 text-muted-foreground" />
          알림 채널 (개인 워크플로우 URL)
          {savedUrl && <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-900">사용 중</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Teams에서 “웹후크 요청을 받은 경우” 트리거로 만든 워크플로우 URL을 넣으면, 내가 만든 알림(RFP SharePoint 업로드·팀 구성 결과)이 이 채널로 갑니다.
          비워 두면 관리자가 설정한 채널로 갑니다. 사내망·로컬 주소는 넣을 수 없습니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />불러오는 중…
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && dirty && url.trim() && save()}
              placeholder="https://…logic.azure.com/… 워크플로우 URL"
              className="h-9 min-w-[16rem] flex-1 font-mono text-xs"
            />
            <Button size="sm" className="h-9" disabled={busy || !dirty || !url.trim()} onClick={save}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : !dirty && savedUrl ? <Check className="mr-1 h-4 w-4" /> : null}
              저장
            </Button>
            <Button variant="outline" size="sm" className="h-9" disabled={busy} onClick={test}>
              <Send className="mr-1 h-3.5 w-3.5" />테스트 전송
            </Button>
            {savedUrl && (
              <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" disabled={busy} onClick={clear}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />해제
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      </CardContent>
    </Card>
  );
}
