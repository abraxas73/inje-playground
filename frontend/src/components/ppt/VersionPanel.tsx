"use client";
import { useState } from "react";
import { CheckCircle2, Download, FileCode2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { readError } from "@/lib/ppt/client";
import { estimateCostUsd, formatUsd, PRICES_AS_OF } from "@/lib/ppt/pricing";
import { formatElapsed } from "@/lib/ppt/elapsed";
import { brandCheckItems } from "@/lib/ppt/brand-check";
import ElapsedSince from "./ElapsedSince";
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
  const active = version.status === "generating" || version.status === "building";
  const cost = estimateCostUsd(version.llmModel, version.tokens);
  const STATUS_LABEL = { generating: "생성 중", building: "빌드 중", done: "완료", failed: "실패" } as const;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">v{version.no}{version.slideCount ? ` · ${version.slideCount}장` : ` · ${STATUS_LABEL[version.status]}`}{active && <> · <ElapsedSince since={version.createdAt} /></>}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {version.status === "done" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => download("pptx")}><Download className="mr-1 h-4 w-4" />PPTX</Button>
            <Button size="sm" variant="outline" onClick={() => download("yaml")}><FileCode2 className="mr-1 h-4 w-4" />deck.yaml</Button>
          </div>
        )}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {version.status === "done" && (
          <div>
            <div className="text-xs text-muted-foreground">브랜드 검사 <span className="text-foreground">{issueCount === 0 ? "· 통과" : `· ${issueCount}건 위반`}</span> <span>— 템플릿 v1.0 규칙</span></div>
            <ul className="mt-1 space-y-1">
              {brandCheckItems(version.checkIssues).map((it) => (
                <li key={it.key} className="text-xs">
                  <div className="flex items-center gap-1.5">
                    {it.issues.length === 0 ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-label="통과" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="위반" />}
                    <span className="font-medium">{it.label}</span>
                    <span className="text-muted-foreground">{it.issues.length === 0 ? it.desc : `${it.issues.length}건`}</span>
                  </div>
                  {it.issues.length > 0 && <ul className="mt-0.5 list-disc pl-9 text-muted-foreground">{it.issues.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {version.advisories.length > 0 && (
          <details><summary className="cursor-pointer text-xs text-muted-foreground">권고 {version.advisories.length}건</summary>
            <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">{version.advisories.map((a, i) => <li key={i}>{a}</li>)}</ul></details>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {!active && (<>
            <span>모델</span><span className="text-foreground">{version.llmModel ?? "-"}</span>
            <span>호출</span><span className="text-foreground">{version.llmCalls}회{version.durationMs ? ` · ${formatElapsed(version.durationMs)}` : ""}</span>
            <span>입력 토큰</span><span className="text-foreground">{n(version.tokens.in)}<span className="text-muted-foreground"> + 캐시 읽기 {n(version.tokens.cacheRead)} · 캐시 쓰기 {n(version.tokens.cacheWrite)}</span></span>
            <span>출력 토큰</span><span className="text-foreground">{n(version.tokens.out)}</span>
            <span>비용(추정)</span><span className="text-foreground">{cost === null ? (version.llmModel ? "단가 미등록" : "-") : <>{formatUsd(cost)}<span className="text-muted-foreground"> · API 공시가 {PRICES_AS_OF} 기준</span></>}</span>
          </>)}
          {version.feedback && <><span>피드백</span><span className="text-foreground">{version.feedback}{version.baseVersion ? ` (v${version.baseVersion} 기준)` : ""}</span></>}
          {version.prompt && <><span>프롬프트</span><span className="text-foreground">{version.prompt}</span></>}
          <span>원고</span><span className="text-foreground break-all">{version.sourceName ?? (version.sourceKind === "text" ? "텍스트" : "-")}</span>
          {version.templateName && <><span>템플릿</span><span className="text-foreground break-all">{version.templateName}</span></>}
        </div>
      </CardContent>
    </Card>
  );
}
