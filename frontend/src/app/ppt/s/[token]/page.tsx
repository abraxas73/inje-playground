"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Download, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Storyboard from "@/components/ppt/Storyboard";
import { readError } from "@/lib/ppt/client";
import { storyboard } from "@/lib/ppt/storyboard";
import type { PptSharedDeck } from "@/types/ppt";

export default function SharedDeckPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"loading" | "ok" | "login" | "gone" | "error">("loading");
  const [deck, setDeck] = useState<PptSharedDeck | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ppt/shared/${token}`);
        if (res.ok) { setDeck((await res.json()) as PptSharedDeck); setState("ok"); return; }
        const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        setError(body.error ?? null);
        setState(body.code === "login_required" ? "login" : res.status === 404 ? "gone" : "error");
      } catch {
        setError("불러오지 못했습니다(네트워크 오류).");
        setState("error");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [token]);

  const sections = useMemo(() => (deck ? storyboard(deck.deckJson) : []), [deck]);
  const download = async () => {
    const res = await fetch(`/api/ppt/shared/${token}/file`);
    if (!res.ok) { setError(await readError(res, "다운로드 URL을 받지 못했습니다.")); return; }
    window.location.href = ((await res.json()) as { url: string }).url;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      {state === "loading" && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
      {state === "login" && (
        <Alert><AlertDescription className="flex flex-wrap items-center gap-2">이 PPT는 로그인한 사내 사용자만 볼 수 있습니다.
          <Button asChild size="sm"><Link href={`/login?next=${encodeURIComponent(`/ppt/s/${token}`)}`}>사내 계정으로 로그인</Link></Button></AlertDescription></Alert>
      )}
      {state === "gone" && <Alert><AlertDescription>{error ?? "공유 링크가 없거나 꺼져 있습니다."}</AlertDescription></Alert>}
      {state === "error" && <Alert variant="destructive"><AlertDescription>{error ?? "불러오지 못했습니다."}</AlertDescription></Alert>}
      {state === "ok" && deck && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Presentation className="h-5 w-5 text-sky-600" /><h1 className="text-lg font-semibold">{deck.title}</h1>
            <span className="text-xs text-muted-foreground">{deck.ownerEmail} · v{deck.version} · {deck.slideCount ?? "-"}장</span>
            <Button size="sm" className="ml-auto" onClick={download}><Download className="mr-1 h-4 w-4" />PPTX 다운로드</Button>
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Storyboard sections={sections} />
        </>
      )}
    </div>
  );
}
