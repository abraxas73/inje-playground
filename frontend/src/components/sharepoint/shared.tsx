"use client";
import Link from "next/link";
import { ExternalLink, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { SharepointItem } from "@/lib/sharepoint/core";

/** API 오류 → 화면 상태. 미연결·만료는 연결 안내로 */
export type ApiProblem = { kind: "connect" | "error"; message: string };
export async function sharepointFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (data as { code?: string }).code;
    throw { kind: code === "not_connected" || code === "reconnect" ? "connect" : "error", message: (data as { error?: string }).error || "SharePoint 요청에 실패했습니다." } satisfies ApiProblem;
  }
  return data as T;
}
export const asProblem = (e: unknown): ApiProblem => (e && typeof e === "object" && "kind" in e ? (e as ApiProblem) : { kind: "error", message: "SharePoint 요청에 실패했습니다." });

export function ConnectNotice({ problem }: { problem: ApiProblem }) {
  return <Card><CardContent className="space-y-3 py-6">
    <p className="text-sm">{problem.message}</p>
    <Button asChild><Link href="/settings">Microsoft 계정 연결</Link></Button>
  </CardContent></Card>;
}

const ICON: Record<string, string> = { docx: "W", doc: "W", xlsx: "X", xls: "X", pptx: "P", ppt: "P", pdf: "PDF", hwp: "H", hwpx: "H", txt: "T", md: "M", html: "H", htm: "H" };
const TONE: Record<string, string> = { W: "bg-blue-100 text-blue-700", X: "bg-green-100 text-green-700", P: "bg-orange-100 text-orange-700", PDF: "bg-red-100 text-red-700" };
export function FileBadge({ ext, folder }: { ext: string; folder?: boolean }) {
  const label = folder ? "📁" : ICON[ext] ?? (ext ? ext.slice(0, 4).toUpperCase() : "·");
  return <span aria-hidden className={`inline-flex h-8 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${TONE[label] ?? "bg-muted text-muted-foreground"}`}>{label}</span>;
}

export const when = (iso: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export type RowItem = Pick<SharepointItem, "id" | "driveId" | "name" | "url" | "container" | "kind"> & Partial<Pick<SharepointItem, "at" | "by" | "ext">>;
/** 한 줄 — 누르면 SharePoint에서 열고, ★는 즐겨찾기 넣기/빼기(onStar가 있을 때) */
export function ItemRow({ item, starred, onStar }: { item: RowItem; starred?: boolean; onStar?: (item: RowItem, starred: boolean) => void }) {
  const ext = item.ext ?? (item.name.includes(".") ? item.name.slice(item.name.lastIndexOf(".") + 1).toLowerCase() : "");
  return <li className="flex items-center gap-2">
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
      <FileBadge ext={ext} folder={item.kind === "folder"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.name}</span>
        <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {item.container && <span className="truncate">{item.container}</span>}
          {item.by && <span>{item.by}</span>}
          {item.at && <span>{when(item.at)}</span>}
        </span>
      </span>
      <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </a>
    {onStar && <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={starred ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"} aria-pressed={!!starred} onClick={() => onStar(item, !!starred)}>
      <Star className={starred ? "h-4 w-4 fill-amber-400 text-amber-500" : "h-4 w-4 text-muted-foreground"} />
    </Button>}
  </li>;
}
