"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import SolutionList, { SolutionHeader } from "@/components/admin/rfp-catalog/SolutionList";
import SourceTable from "@/components/admin/rfp-catalog/SourceTable";
import FeatureTable from "@/components/admin/rfp-catalog/FeatureTable";
import type { RfpAdminSolution } from "@/types/rfp";

export default function RfpCatalogPage() {
  const [solutions, setSolutions] = useState<RfpAdminSolution[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 가져오기가 끝나면 +1 → 기능 표가 다시 조회한다 */
  const [featureVersion, setFeatureVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/rfp-catalog/solutions");
      const json = (await res.json()) as { solutions?: RfpAdminSolution[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const list = json.solutions ?? [];
      setSolutions(list);
      setSelected((cur) => (cur && list.some((s) => s.code === cur) ? cur : list[0]?.code ?? null));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "솔루션 목록을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const current = solutions.find((s) => s.code === selected) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Layers className="h-5 w-5" />RFP 솔루션 카탈로그</h1>
        <p className="text-sm text-muted-foreground">솔루션별 기능 목록. Confluence 페이지를 등록해 가져오면 Claude가 기능을 정리하고, 사람이 고친 항목은 다음 가져오기가 덮어쓰지 않습니다. RFP 요구사항 매핑이 이 카탈로그를 기준으로 실행됩니다.</p>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <SolutionList solutions={solutions} selected={selected} onSelect={setSelected} onChanged={load} />
        {current ? (
          <div className="min-w-0 space-y-4">
            <SolutionHeader solution={current} onChanged={load} onDeleted={() => { setSelected(null); void load(); }} />
            <SourceTable solution={current} onImported={() => { setFeatureVersion((v) => v + 1); void load(); }} />
            <FeatureTable solution={current} refreshKey={featureVersion} onChanged={load} />
          </div>
        ) : (
          <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">솔루션을 선택하거나 추가하세요.</div>
        )}
      </div>
    </div>
  );
}
