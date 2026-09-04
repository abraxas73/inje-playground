"use client";

import { useState } from "react";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchableSelect, { type SearchableOption } from "@/components/shared/SearchableSelect";
import { requiresFeature, VERDICT_LABEL, VERDICT_ORDER, type CatalogSolution, type Verdict } from "@/lib/rfp/mapping/types";
import type { RfpMapping, RfpRequirement } from "@/types/rfp";

interface Props {
  projectId: string;
  requirement: RfpRequirement;
  rows: RfpMapping[];
  catalog: CatalogSolution[];
  /** 이 요구사항의 행이 바뀌면 전체 목록에서 교체할 수 있게 새 행 목록을 준다 */
  onChange: (rows: RfpMapping[]) => void;
}

/** 규칙 필드(판정·솔루션·기능) 중 아직 저장 못 한 선택 — 충족/부분충족인데 기능을 아직 안 골랐을 때 */
interface Pending { verdict: Verdict; solutionCode: string | null; featureId: string | null }

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

export default function MappingEditor({ projectId, requirement, rows, catalog, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [draft, setDraft] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const solutionOptions: SearchableOption[] = catalog.filter((s) => s.isActive).map((s) => ({ value: s.code, label: s.name }));
  const featureOptions = (solutionCode: string | null, currentFeatureId: string | null): SearchableOption[] => {
    const sol = catalog.find((s) => s.code === solutionCode);
    if (!sol) return [];
    return sol.features
      .filter((f) => f.isActive || f.id === currentFeatureId)
      .map((f) => ({ value: f.id, label: f.isActive ? f.name : `${f.name} (비활성)`, hint: f.description.slice(0, 40) }));
  };

  const replaceRow = (updated: RfpMapping) => onChange(rows.map((r) => (r.id === updated.id ? updated : r)));

  const patch = async (row: RfpMapping, body: Record<string, unknown>) => {
    setError(null);
    const res = await fetch(`/api/rfp/mappings/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await readError(res, "저장에 실패했습니다."));
    replaceRow((await res.json()) as RfpMapping);
  };

  /** 판정·솔루션·기능 변경. 충족/부분충족인데 기능이 없으면 저장하지 않고 pending에 둔다. */
  const changeRule = async (row: RfpMapping, next: Partial<Pending>) => {
    const cur: Pending = pending[row.id] ?? { verdict: row.verdict, solutionCode: row.solutionCode, featureId: row.featureId };
    const merged: Pending = { ...cur, ...next };
    if (next.solutionCode !== undefined && next.solutionCode !== cur.solutionCode) merged.featureId = null;
    if (!requiresFeature(merged.verdict)) { merged.solutionCode = null; merged.featureId = null; }
    if (requiresFeature(merged.verdict) && !merged.featureId) { setPending((p) => ({ ...p, [row.id]: merged })); return; }
    try {
      await patch(row, { ...merged });
      setPending((p) => { const rest = { ...p }; delete rest[row.id]; return rest; });
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    }
  };

  const changeText = async (row: RfpMapping, field: "rationale" | "evidenceUrl", value: string) => {
    if ((row[field] ?? "") === value) return;
    try {
      await patch(row, { [field]: field === "evidenceUrl" ? value || null : value });
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    }
  };

  const remove = async (row: RfpMapping) => {
    setError(null);
    const res = await fetch(`/api/rfp/mappings/${row.id}`, { method: "DELETE" });
    if (!res.ok) { setError(await readError(res, "삭제에 실패했습니다.")); return; }
    onChange(rows.filter((r) => r.id !== row.id));
  };

  /** 새 행: 판정이 build/na이거나 기능까지 골랐을 때 POST */
  const changeDraft = async (next: Partial<Pending>) => {
    const cur: Pending = draft ?? { verdict: "partial", solutionCode: null, featureId: null };
    const merged: Pending = { ...cur, ...next };
    if (next.solutionCode !== undefined && next.solutionCode !== cur.solutionCode) merged.featureId = null;
    if (!requiresFeature(merged.verdict)) { merged.solutionCode = null; merged.featureId = null; }
    if (requiresFeature(merged.verdict) && !merged.featureId) { setDraft(merged); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rfp/projects/${projectId}/mapping/rows`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirementId: requirement.id, ...merged }),
      });
      if (!res.ok) throw new Error(await readError(res, "추가에 실패했습니다."));
      onChange([...rows, (await res.json()) as RfpMapping]);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const ruleRow = (value: Pending, onRule: (next: Partial<Pending>) => void, keyPrefix: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value.verdict} onValueChange={(v) => onRule({ verdict: v as Verdict })}>
        <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{VERDICT_ORDER.map((v) => <SelectItem key={`${keyPrefix}-${v}`} value={v}>{VERDICT_LABEL[v]}</SelectItem>)}</SelectContent>
      </Select>
      <SearchableSelect value={value.solutionCode ?? ""} onChange={(v) => onRule({ solutionCode: v })} options={solutionOptions} placeholder="솔루션" className={`w-40 ${requiresFeature(value.verdict) ? "" : "pointer-events-none opacity-50"}`} />
      <SearchableSelect value={value.featureId ?? ""} onChange={(v) => onRule({ featureId: v })} options={featureOptions(value.solutionCode, value.featureId)} placeholder={value.solutionCode ? "기능" : "솔루션 먼저"} emptyText="활성 기능이 없습니다" className={`w-56 ${requiresFeature(value.verdict) ? "" : "pointer-events-none opacity-50"}`} />
      {requiresFeature(value.verdict) && !value.featureId && <span className="text-xs text-amber-700">기능을 고르면 저장됩니다</span>}
    </div>
  );

  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">{requirement.reqId} 솔루션 매핑 {sorted.length}행</div>
        <Button size="sm" variant="outline" disabled={busy || draft !== null} onClick={() => setDraft({ verdict: "partial", solutionCode: null, featureId: null })}><Plus className="mr-1 h-4 w-4" />행 추가</Button>
      </div>
      {sorted.map((row) => {
        const value = pending[row.id] ?? { verdict: row.verdict, solutionCode: row.solutionCode, featureId: row.featureId };
        return (
          <div key={row.id} className="space-y-2 rounded-md border bg-background p-3" title={row.updatedBy ? `수정 ${new Date(row.updatedAt).toLocaleString("ko-KR")}` : undefined}>
            <div className="flex items-start justify-between gap-2">
              {ruleRow(value, (next) => changeRule(row, next), row.id)}
              <div className="flex items-center gap-1">
                {row.edited && <Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-label="사람이 고친 행" />}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="행 삭제" onClick={() => remove(row)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <Textarea defaultValue={row.rationale} rows={2} placeholder="설명(왜 이 판정인지)" className="min-h-0 text-sm" onBlur={(e) => changeText(row, "rationale", e.target.value.trim())} />
            <div className="flex items-center gap-1">
              <Input defaultValue={row.evidenceUrl ?? ""} placeholder="근거 URL" className="h-8 text-xs" onBlur={(e) => changeText(row, "evidenceUrl", e.target.value.trim())} />
              {row.evidenceUrl && <a href={row.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-4 w-4" /></a>}
            </div>
          </div>
        );
      })}
      {draft && (
        <div className="space-y-2 rounded-md border border-dashed bg-background p-3">
          <div className="flex items-start justify-between gap-2">
            {ruleRow(draft, changeDraft, "draft")}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>취소</Button>
          </div>
          <div className="text-xs text-muted-foreground">설계·구축영역/해당없음을 고르면 바로 추가되고, 충족/부분충족은 기능까지 고르면 추가됩니다. 설명·근거 URL은 추가된 뒤 입력하세요.</div>
        </div>
      )}
      {!sorted.length && !draft && <div className="text-sm text-muted-foreground">매핑이 없습니다(미매핑). &quot;행 추가&quot;로 직접 매핑하거나 개요의 &quot;솔루션 매핑 실행&quot;을 누르세요.</div>}
      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
