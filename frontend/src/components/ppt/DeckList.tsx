"use client";
import { useState } from "react";
import Link from "next/link";
import { Link2, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import StatusBadge from "./StatusBadge";
import { postJson } from "@/lib/ppt/client";
import { formatUsd } from "@/lib/ppt/pricing";
import { BUILTIN_TEMPLATE_LABEL, PPT_MODEL_OPTIONS, type PptDeckSummary } from "@/types/ppt";

const modelLabel = (id: string | null | undefined) => (id ? PPT_MODEL_OPTIONS.find((m) => m.id === id)?.label ?? id : "-");

const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

/** viewer를 주면 내 것·관리자만 상세로 열고 삭제할 수 있다 — 남의 공유 덱은 공유 뷰로 열고 삭제 버튼이 없다. showShared는 관리자 화면에서 공유 링크 켜짐 여부를 열로 보여 준다(2026-10-10 사용자 요청) */
export default function DeckList({ decks, showOwner, showShared, viewer, onDeleted, onError }: { decks: PptDeckSummary[]; showOwner: boolean; showShared?: boolean; viewer?: { userId: string | null; isAdmin: boolean }; onDeleted: () => void; onError: (msg: string) => void }) {
  const manageable = (d: PptDeckSummary) => !viewer || viewer.isAdmin || (d.ownerId !== null && d.ownerId === viewer.userId);
  const [target, setTarget] = useState<PptDeckSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const remove = async (d: PptDeckSummary) => {
    setBusy(d.id);
    try { await postJson(`/api/ppt/decks/${d.id}`, undefined, "DELETE"); onDeleted(); }
    catch (e) { onError(e instanceof Error ? e.message : "삭제에 실패했습니다."); }
    finally { setBusy(null); }
  };
  if (!decks.length) return <p className="py-8 text-center text-sm text-muted-foreground">{showOwner ? "회사에 공유된 PPT가 아직 없습니다." : "아직 만든 PPT가 없습니다. 위에서 원고를 넣고 생성해 보세요."}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">{/* 좁은 화면(앱 WebView·폰)에선 열을 짜부라뜨리지 않고 가로 스크롤 */}
        <thead className="bg-muted/50 text-left text-xs whitespace-nowrap text-muted-foreground">
          <tr>
            <th className="px-3 py-2">제목</th>{showOwner && <th className="px-3 py-2">소유자</th>}{showShared && <th className="px-3 py-2" title="소유자가 공유 링크를 켰는지">공유</th>}<th className="px-3 py-2">버전</th><th className="px-3 py-2">장 수</th><th className="px-3 py-2">템플릿</th><th className="px-3 py-2">모델</th><th className="px-3 py-2 text-right" title="모든 버전의 LLM 추정 비용 합">비용</th><th className="px-3 py-2">상태</th><th className="px-3 py-2">수정</th><th className="w-10 px-3 py-2"><span className="sr-only">삭제</span></th>
          </tr>
        </thead>
        <tbody>
          {decks.map((d) => (
            <tr key={d.id} className="border-t hover:bg-muted/30">
              <td className="max-w-[280px] px-3 py-2">
                <span className="flex items-center gap-1">
                  <Link href={manageable(d) ? `/ppt/${d.id}` : d.shareUrl ?? `/ppt/${d.id}`} className="truncate font-medium hover:underline" title={d.title}>{d.title}</Link>
                  {d.shareEnabled && <span title="공유 링크 켜짐" className="flex shrink-0"><Link2 className="h-3 w-3 text-muted-foreground" aria-label="공유 링크 켜짐" /></span>}
                </span>
              </td>
              {showOwner && <td className="px-3 py-2 text-muted-foreground" title={d.ownerEmail}>{d.ownerLabel ?? d.ownerEmail}</td>}
              {showShared && <td className="whitespace-nowrap px-3 py-2">{d.shareEnabled ? <Badge variant="secondary">공유 중</Badge> : <span className="text-muted-foreground">비공개</span>}</td>}
              <td className="px-3 py-2">{d.latest ? `v${d.latest.no}` : "-"}</td>
              <td className="px-3 py-2">{d.latest?.slideCount ?? "-"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{d.latest ? (!d.latest.templateName || d.latest.templateName === BUILTIN_TEMPLATE_LABEL ? "기본형" : d.latest.templateName) : "-"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{modelLabel(d.latest?.llmModel)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{d.costUsd === null ? "-" : formatUsd(d.costUsd)}</td>
              <td className="px-3 py-2">{d.latest ? <StatusBadge status={d.latest.status} /> : "-"}</td>
              <td className="px-3 py-2 text-muted-foreground">{fmt(d.updatedAt)}</td>
              <td className="px-1 py-1 text-right">
                {manageable(d) && <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={busy !== null} onClick={() => setTarget(d)} aria-label={`${d.title} 삭제`}>
                  {busy === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AlertDialog open={target !== null} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>덱을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>&quot;{target?.title}&quot;의 모든 버전·원고·PPT 파일과 공유 링크가 함께 삭제됩니다. 되돌릴 수 없습니다.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { if (target) void remove(target); setTarget(null); }}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
