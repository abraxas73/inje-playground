"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import NewDeckForm from "@/components/ppt/NewDeckForm";
import DeckList from "@/components/ppt/DeckList";
import { useUserRole } from "@/hooks/useUserRole";
import type { PptListResponse } from "@/types/ppt";

export default function PptPage() {
  const router = useRouter();
  const { isAdmin, userId } = useUserRole();
  const [all, setAll] = useState(false);
  const [data, setData] = useState<PptListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/ppt/decks${all ? "?all=1" : ""}`);
    if (!res.ok) { setError("목록을 불러오지 못했습니다."); return; }
    setData((await res.json()) as PptListResponse);
  }, [all]);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2"><Presentation className="h-6 w-6 text-sky-600" /><h1 className="text-xl font-semibold">PPT 만들기</h1></div>
      <p className="text-sm text-muted-foreground">원고와 프롬프트를 넣으면 이노그리드 표준 템플릿으로 PPT를 만듭니다. 생성 뒤 피드백으로 다시 만들고, 링크·Teams·SharePoint로 공유하세요.</p>
      {data && <NewDeckForm llmAvailable={data.llmAvailable} templates={data.templates ?? []} onCreated={(id) => router.push(`/ppt/${id}`)} />}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">{all ? "공유된 덱" : "내 덱"}</h2>
        <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>{all ? "내 덱만" : "공유된 덱 보기"}</Button>
      </div>
      {all && <p className="-mt-4 text-xs text-muted-foreground">구성원이 공유 링크를 켠 덱입니다. 제목을 누르면 공유 뷰로 열립니다(내 덱·관리자는 상세로).</p>}
      {data && <DeckList decks={data.decks} showOwner={all} viewer={{ userId, isAdmin }} onDeleted={() => { setError(null); void load(); }} onError={setError} />}
    </div>
  );
}
