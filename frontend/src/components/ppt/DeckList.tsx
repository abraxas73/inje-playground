"use client";
import Link from "next/link";
import { Link2 } from "lucide-react";
import StatusBadge from "./StatusBadge";
import type { PptDeckSummary } from "@/types/ppt";

const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

export default function DeckList({ decks, showOwner }: { decks: PptDeckSummary[]; showOwner: boolean }) {
  if (!decks.length) return <p className="py-8 text-center text-sm text-muted-foreground">아직 만든 PPT가 없습니다. 위에서 원고를 넣고 생성해 보세요.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">제목</th>{showOwner && <th className="px-3 py-2">소유자</th>}<th className="px-3 py-2">버전</th><th className="px-3 py-2">장 수</th><th className="px-3 py-2">상태</th><th className="px-3 py-2">수정</th>
          </tr>
        </thead>
        <tbody>
          {decks.map((d) => (
            <tr key={d.id} className="border-t hover:bg-muted/30">
              <td className="px-3 py-2">
                <Link href={`/ppt/${d.id}`} className="font-medium hover:underline">{d.title}</Link>
                {d.shareEnabled && <Link2 className="ml-1 inline h-3 w-3 text-muted-foreground" aria-label="공유 켜짐" />}
              </td>
              {showOwner && <td className="px-3 py-2 text-muted-foreground">{d.ownerEmail}</td>}
              <td className="px-3 py-2">{d.latest ? `v${d.latest.no}` : "-"}</td>
              <td className="px-3 py-2">{d.latest?.slideCount ?? "-"}</td>
              <td className="px-3 py-2">{d.latest ? <StatusBadge status={d.latest.status} /> : "-"}</td>
              <td className="px-3 py-2 text-muted-foreground">{fmt(d.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
