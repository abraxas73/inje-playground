"use client";
import { useState } from "react";
import { Download, FileCode2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { readError } from "@/lib/ppt/client";
import type { PptVersion } from "@/types/ppt";

const n = (v: number) => v.toLocaleString("ko-KR");

export default function VersionPanel({ deckId, version }: { deckId: string; version: PptVersion }) {
  const [error, setError] = useState<string | null>(null);
  const download = async (kind: "pptx" | "yaml") => {
    setError(null);
    let res: Response;
    try { res = await fetch(`/api/ppt/decks/${deckId}/versions/${version.no}/file?kind=${kind}`); }
    catch { setError("다운로드 URL을 받지 못했습니다(네트워크 오류)."); return; }
    if (!res.ok) { setError(await readError(res, "다운로드 URL을 받지 못했습니다.")); return; }
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
  };
  const issueCount = Object.values(version.checkIssues).reduce((a, b) => a + b.length, 0);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">v{version.no} · {version.slideCount ?? "-"}장</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {version.status === "done" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => download("pptx")}><Download className="mr-1 h-4 w-4" />PPTX</Button>
            <Button size="sm" variant="outline" onClick={() => download("yaml")}><FileCode2 className="mr-1 h-4 w-4" />deck.yaml</Button>
          </div>
        )}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div><div className="text-xs text-muted-foreground">브랜드 검사</div><div>{version.status !== "done" ? "-" : issueCount === 0 ? "통과" : `${issueCount}건 위반`}</div>
          {issueCount > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">{Object.entries(version.checkIssues).map(([slide, msgs]) => msgs.map((m, i) => <li key={`${slide}-${i}`}>{slide}: {m}</li>))}</ul>}
        </div>
        {version.advisories.length > 0 && (
          <details><summary className="cursor-pointer text-xs text-muted-foreground">권고 {version.advisories.length}건</summary>
            <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">{version.advisories.map((a, i) => <li key={i}>{a}</li>)}</ul></details>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>모델</span><span className="text-foreground">{version.llmModel ?? "-"}</span>
          <span>호출</span><span className="text-foreground">{version.llmCalls}회 · {version.durationMs ? `${Math.round(version.durationMs / 1000)}초` : "-"}</span>
          <span>입력 토큰</span><span className="text-foreground">{n(version.tokens.in)} (캐시 적중 {n(version.tokens.cacheRead)} · 생성 {n(version.tokens.cacheWrite)})</span>
          <span>출력 토큰</span><span className="text-foreground">{n(version.tokens.out)}</span>
          {version.feedback && <><span>피드백</span><span className="text-foreground">{version.feedback}{version.baseVersion ? ` (v${version.baseVersion} 기준)` : ""}</span></>}
          {version.prompt && <><span>프롬프트</span><span className="text-foreground">{version.prompt}</span></>}
          <span>원고</span><span className="text-foreground">{version.sourceName ?? (version.sourceKind === "text" ? "텍스트" : "-")}</span>
        </div>
      </CardContent>
    </Card>
  );
}
