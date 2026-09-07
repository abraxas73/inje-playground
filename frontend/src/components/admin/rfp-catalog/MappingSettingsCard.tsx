"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAPPING_CANDIDATES_DEFAULT, MAPPING_CANDIDATES_MAX, MAPPING_CANDIDATES_MIN, MAPPING_MAX_CANDIDATES_KEY, parseMaxCandidates } from "@/lib/rfp/mapping/settings";

/**
 * 솔루션 매핑 운영 설정 — 규칙 엔진이 요구사항 하나에 붙이는 후보 개수 상한(1~5, 기본 5).
 * 전역 settings 테이블에 저장하고(PUT /api/settings, admin only) 다음 매핑 실행부터 적용된다.
 */
export default function MappingSettingsCard() {
  const [value, setValue] = useState<number>(MAPPING_CANDIDATES_DEFAULT);
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const json = (await res.json()) as Record<string, string> & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const n = json[MAPPING_MAX_CANDIDATES_KEY] === undefined ? MAPPING_CANDIDATES_DEFAULT : parseMaxCandidates(json[MAPPING_MAX_CANDIDATES_KEY]);
      setValue(n);
      setSaved(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : "설정을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const next = parseMaxCandidates(value);
    setValue(next);
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: MAPPING_MAX_CANDIDATES_KEY, value: String(next) }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "저장에 실패했습니다.");
      setSaved(next);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const dirty = saved !== null && parseMaxCandidates(value) !== saved;
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium"><SlidersHorizontal className="h-4 w-4" />솔루션 매핑 설정</div>
      <p className="mb-3 text-xs text-muted-foreground">
        규칙(키워드) 엔진이 요구사항 하나에 붙일 후보 개수의 상한입니다({MAPPING_CANDIDATES_MIN}~{MAPPING_CANDIDATES_MAX}, 기본 {MAPPING_CANDIDATES_DEFAULT}).
        같은 솔루션에서는 최대 2개까지만 고르므로, 상한을 높이면 여러 솔루션의 후보가 함께 보입니다. 다음 매핑 실행부터 적용되고 이미 만든 매핑은 그대로 남습니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="rfp-max-candidates" className="text-xs text-muted-foreground">요구사항당 최대 후보</label>
        <Input
          id="rfp-max-candidates" type="number" inputMode="numeric"
          min={MAPPING_CANDIDATES_MIN} max={MAPPING_CANDIDATES_MAX} step={1}
          value={value} disabled={busy}
          onChange={(e) => setValue(e.target.value === "" ? MAPPING_CANDIDATES_MIN : Number(e.target.value))}
          onBlur={() => setValue((v) => parseMaxCandidates(v))}
          className="h-8 w-20"
        />
        <span className="text-xs text-muted-foreground">개</span>
        <Button size="sm" variant="outline" disabled={busy || !dirty} onClick={save}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}저장
        </Button>
        {done && <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3.5 w-3.5" />저장했습니다</span>}
      </div>
      {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
    </div>
  );
}
