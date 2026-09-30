"use client";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { postJson } from "@/lib/ppt/client";

export default function FeedbackBox({ deckId, baseVersion, disabled, onStarted }: { deckId: string; baseVersion: number; disabled: boolean; onStarted: () => void }) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await postJson(`/api/ppt/decks/${deckId}/regenerate`, { feedback, baseVersion });
      setFeedback("");
      onStarted();
    } catch (e) { setError(e instanceof Error ? e.message : "재생성 요청에 실패했습니다."); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} maxLength={2000} disabled={disabled || busy} placeholder={`v${baseVersion}을 기준으로 바꿀 점을 적으세요. 예: 3장을 표로 바꿔줘, 2섹션을 두 장으로 나눠줘`} />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex justify-end"><Button size="sm" onClick={submit} disabled={disabled || busy || !feedback.trim()}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}이 지시로 다시 만들기</Button></div>
    </div>
  );
}
