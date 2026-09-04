"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RfpMappingStatus, RfpProjectStatus, RfpProjectSummary } from "@/types/rfp";

export function StatusBadge({ status }: { status: RfpProjectStatus }) {
  if (status === "extracting") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />추출 중</Badge>;
  if (status === "failed") return <Badge variant="destructive">실패</Badge>;
  return <Badge>완료</Badge>;
}

export function MappingStatusBadge({ status }: { status: RfpMappingStatus }) {
  if (status === "running") return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />매핑 중</Badge>;
  if (status === "failed") return <Badge variant="destructive">매핑 실패</Badge>;
  if (status === "ready") return <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-900">매핑 완료</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">매핑 없음</Badge>;
}

export default function ProjectList({ projects, loading }: { projects: RfpProjectSummary[]; loading: boolean }) {
  if (loading) return <div className="py-10 text-center text-sm text-muted-foreground">불러오는 중…</div>;
  if (!projects.length) return <div className="py-10 text-center text-sm text-muted-foreground">등록된 프로젝트가 없습니다. 위에서 제안요청서를 올려 시작하세요.</div>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">사업명</th>
            <th className="px-3 py-2">발주기관</th>
            <th className="px-3 py-2 text-right">요구사항</th>
            <th className="px-3 py-2">상태</th>
            <th className="px-3 py-2">매핑</th>
            <th className="px-3 py-2">등록자</th>
            <th className="px-3 py-2">등록일</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-t hover:bg-muted/30">
              <td className="px-3 py-2"><Link href={`/rfp/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
              <td className="px-3 py-2 text-muted-foreground">{p.agency ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.requirementCount}</td>
              <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
              <td className="px-3 py-2"><MappingStatusBadge status={p.mappingStatus} /></td>
              <td className="px-3 py-2 text-muted-foreground">{p.createdBy.name ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{new Date(p.createdAt).toLocaleDateString("ko-KR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
