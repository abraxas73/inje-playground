"use client";
import { useState } from "react";
import { CheckCircle2, Download, FileCode2, FileText, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { readError } from "@/lib/ppt/client";
import { estimateCostUsd, formatUsd, PRICES_AS_OF } from "@/lib/ppt/pricing";
import { formatElapsed } from "@/lib/ppt/elapsed";
import { brandCheckItems } from "@/lib/ppt/brand-check";
import ElapsedSince from "./ElapsedSince";
import type { PptVersion } from "@/types/ppt";

const n = (v: number) => v.toLocaleString("ko-KR");

export default function VersionPanel({ deckId, version }: { deckId: string; version: PptVersion }) {
  const [error, setError] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const download = async (kind: "pptx" | "yaml" | "source") => {
    setError(null);
    let res: Response;
    try { res = await fetch(`/api/ppt/decks/${deckId}/versions/${version.no}/file?kind=${kind}`); }
    catch { setError("다운로드 URL을 받지 못했습니다(네트워크 오류)."); return; }
    if (!res.ok) { setError(await readError(res, "다운로드 URL을 받지 못했습니다.")); return; }
    const j = (await res.json()) as { url?: string; text?: string };
    if (typeof j.text === "string") { setSourceText(j.text); return; } // 텍스트 원고는 대화상자로
    if (j.url) window.location.href = j.url;
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
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {!active && (<>
            <span>모델</span><span className="text-foreground">{version.llmModel ?? "-"}</span>
            <span>호출</span><span className="text-foreground">{version.llmCalls}회{version.durationMs ? ` · ${formatElapsed(version.durationMs)}` : ""}</span>
            <span>입력 토큰</span><span className="text-foreground">{n(version.tokens.in)}<span className="text-muted-foreground"> + 캐시 읽기 {n(version.tokens.cacheRead)} · 캐시 쓰기 {n(version.tokens.cacheWrite)}</span></span>
            <span>출력 토큰</span><span className="text-foreground">{n(version.tokens.out)}</span>
            <span>비용(추정)</span><span className="text-foreground">{cost === null ? (version.llmModel ? "단가 미등록" : "-") : <>{formatUsd(cost)}<span className="text-muted-foreground"> · API 공시가 {PRICES_AS_OF} 기준</span></>}</span>
          </>)}
          {version.feedback && <><span>피드백</span><span className="text-foreground">{version.feedback}{version.baseVersion ? ` (v${version.baseVersion} 기준)` : ""}</span></>}
          {version.prompt && <><span>프롬프트</span><span className="text-foreground">{version.prompt}</span></>}
          <span>원고</span>
          <span className="text-foreground break-all">
            {version.sourceKind === "text" ? (
              <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" onClick={() => download("source")}><FileText className="h-3.5 w-3.5" />텍스트 원문 보기</button>
            ) : version.sourceKind === "url" ? (
              <span className="flex flex-col items-start gap-0.5">
                <a href={version.sourceName ?? "#"} target="_blank" rel="noreferrer" className="break-all underline-offset-2 hover:underline">{version.sourceName}</a>
                {version.sourceImages > 0 && <span className="text-xs text-muted-foreground">이미지 {version.sourceImages}장 가져옴</span>}
                <button type="button" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:underline" onClick={() => download("source")}><FileText className="h-3.5 w-3.5" />가져온 본문 보기</button>
              </span>
            ) : (
              <button type="button" className="inline-flex items-center gap-1 text-left underline-offset-2 hover:underline" title="원본 파일 다운로드" onClick={() => download("source")}><Download className="h-3.5 w-3.5 shrink-0" />{version.sourceName ?? "원본 다운로드"}</button>
            )}
          </span>
          {version.templateName && <><span>템플릿</span><span className="text-foreground break-all">{version.templateName}</span></>}
        </div>
      </CardContent>
      <Dialog open={sourceText !== null} onOpenChange={(o) => { if (!o) setSourceText(null); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
          <DialogHeader><DialogTitle>{version.sourceKind === "url" ? "웹 페이지에서 가져온 본문" : "텍스트 원고"} — v{version.no}</DialogTitle><DialogDescription>{(sourceText ?? "").length.toLocaleString("ko-KR")}자</DialogDescription></DialogHeader>
          <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-3 text-xs leading-relaxed">{sourceText}</pre>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
