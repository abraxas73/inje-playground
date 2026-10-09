"use client";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ConfluenceItem } from "@/lib/confluence/core";

/** API 오류 → 화면 상태. 미연결·권한 부족은 연결 안내로 */
export type ApiProblem = { kind: "connect" | "scope" | "unavailable" | "error"; message: string };
export async function confluenceFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (data as { code?: string }).code;
    const message = (data as { error?: string }).error || "Confluence 요청에 실패했습니다.";
    throw { kind: code === "not_connected" ? "connect" : code === "confluence_scope" || code === "reconnect" ? "scope" : code === "not_configured" ? "unavailable" : "error", message } satisfies ApiProblem;
  }
  return data as T;
}
export const asProblem = (e: unknown): ApiProblem => (e && typeof e === "object" && "kind" in e ? (e as ApiProblem) : { kind: "error", message: "Confluence 요청에 실패했습니다." });

export function ConnectNotice({ problem }: { problem: ApiProblem }) {
  return <Card><CardContent className="space-y-3 py-6">
    <p className="text-sm">{problem.message}</p>
    {(problem.kind === "connect" || problem.kind === "scope") && <Button asChild><Link href="/settings#jira">{problem.kind === "connect" ? "Atlassian 계정 연결" : "다시 연결해 권한 추가"}</Link></Button>}
  </CardContent></Card>;
}

const when = (iso: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
export function ItemRow({ item }: { item: ConfluenceItem }) {
  return <li>
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg px-2 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {item.spaceName && <span className="font-medium text-primary">{item.spaceName}</span>}
        {item.type === "comment" && <span>댓글</span>}
        {item.by && <span>{item.by}</span>}
        {item.lastModified && <span>{when(item.lastModified)}</span>}
        <ExternalLink aria-hidden className="ml-auto h-3.5 w-3.5" />
      </div>
      <p className="mt-1 break-words text-sm font-medium">{item.title}</p>
      {item.excerpt && <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{item.excerpt}</p>}
    </a>
  </li>;
}
