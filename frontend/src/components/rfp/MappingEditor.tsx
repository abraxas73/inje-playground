"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ExternalLink, FileText, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchableSelect, { type SearchableOption } from "@/components/shared/SearchableSelect";
import { ENGINE_LABEL, requiresFeature, VERDICT_LABEL, VERDICT_ORDER, type CatalogFeature, type CatalogSolution, type Verdict } from "@/lib/rfp/mapping/types";
import { indexCatalog } from "@/lib/rfp/mapping/summary";
import { parseDetailUnits } from "@/lib/rfp/mapping/detail-items";
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
  /** 새 행 초안. detailKey = 어느 세부 항목에 넣을지(null = 요구사항 전체) */
  const [draft, setDraft] = useState<(Pending & { detailKey: string | null }) | null>(null);
  const [busy, setBusy] = useState(false);
  /** 근거 URL 입력을 펼친 행 — 기본은 문서 제목·요약만 보이고 URL은 "바로가기"로 */
  const [urlEditing, setUrlEditing] = useState<Record<string, boolean>>({});
  /** 규칙 엔진의 정형 설명("자동 매칭 — …")은 윗줄 끝에 한 줄로만 보이고, 클릭하면 편집 칸이 열린다 */
  const [rationaleEditing, setRationaleEditing] = useState<Record<string, boolean>>({});
  const featureIndex = useMemo(() => indexCatalog(catalog).feature, [catalog]);

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
    const cur = draft ?? { verdict: "partial" as Verdict, solutionCode: null, featureId: null, detailKey: null };
    const merged = { ...cur, ...next };
    if (next.solutionCode !== undefined && next.solutionCode !== cur.solutionCode) merged.featureId = null;
    if (!requiresFeature(merged.verdict)) { merged.solutionCode = null; merged.featureId = null; }
    if (requiresFeature(merged.verdict) && !merged.featureId) { setDraft(merged); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rfp/projects/${projectId}/mapping/rows`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirementId: requirement.id, verdict: merged.verdict, solutionCode: merged.solutionCode, featureId: merged.featureId, detailKey: merged.detailKey }),
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

  /**
   * 한 줄로 고정한다 — 판정·솔루션·기능 선택과 자동 매칭 요약(trailing)이 같은 줄에 있어야 매핑 행이 2줄(선택 줄 + 문서 카드)로 끝난다.
   * 좁아지면 줄바꿈 대신 기능 선택과 요약이 줄어들며 잘린다(선택 콤보·요약 모두 내부에서 truncate). 넘치면 감싸서 가로 스크롤을 만들지 않는다.
   */
  const ruleRow = (value: Pending, onRule: (next: Partial<Pending>) => void, keyPrefix: string, trailing?: ReactNode) => (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <Select value={value.verdict} onValueChange={(v) => onRule({ verdict: v as Verdict })}>
        <SelectTrigger className="h-8 w-28 shrink-0 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{VERDICT_ORDER.map((v) => <SelectItem key={`${keyPrefix}-${v}`} value={v}>{VERDICT_LABEL[v]}</SelectItem>)}</SelectContent>
      </Select>
      <SearchableSelect value={value.solutionCode ?? ""} onChange={(v) => onRule({ solutionCode: v })} options={solutionOptions} placeholder="솔루션" className={`w-32 shrink-0 ${requiresFeature(value.verdict) ? "" : "pointer-events-none opacity-50"}`} />
      <SearchableSelect value={value.featureId ?? ""} onChange={(v) => onRule({ featureId: v })} options={featureOptions(value.solutionCode, value.featureId)} placeholder={value.solutionCode ? "기능" : "솔루션 먼저"} emptyText="활성 기능이 없습니다" className={`w-44 min-w-[6rem] shrink ${requiresFeature(value.verdict) ? "" : "pointer-events-none opacity-50"}`} />
      {requiresFeature(value.verdict) && !value.featureId && <span className="shrink-0 text-xs text-amber-700">기능을 고르면 저장됩니다</span>}
      {trailing}
    </div>
  );

  const sorted = useMemo(() => [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)), [rows]);
  const structure = useMemo(() => parseDetailUnits(requirement.details), [requirement.details]);

  /**
   * 매핑 단위(그룹). 세부 내용이 목록이면 1단 항목마다 한 그룹, 아니면 "요구사항 전체" 한 그룹.
   * 세부 내용을 나중에 고쳐 키가 사라진 행은 저장된 라벨로 별도 그룹에 남긴다(사라지지 않게).
   */
  const groups = useMemo(() => {
    const byKey = new Map<string, RfpMapping[]>();
    for (const r of sorted) {
      const k = r.detailKey ?? "";
      byKey.set(k, [...(byKey.get(k) ?? []), r]);
    }
    const useUnits = !structure.flat && structure.units.length > 1;
    const out: { key: string | null; label: string; text: string; rows: RfpMapping[]; stale?: boolean }[] = [];
    if (useUnits) {
      for (const u of structure.units) out.push({ key: u.key, label: u.label, text: u.text, rows: byKey.get(u.key) ?? [] });
      byKey.delete("");
      for (const u of structure.units) byKey.delete(u.key);
      if ((byKey.size || (sorted.some((r) => !r.detailKey)))) {
        const rest = sorted.filter((r) => !r.detailKey);
        if (rest.length) out.unshift({ key: null, label: "요구사항 전체", text: "", rows: rest });
      }
      for (const [k, rs] of byKey) out.push({ key: k, label: rs[0]?.detailText || `세부 항목 ${k}`, text: "", rows: rs, stale: true });
    } else {
      out.push({ key: null, label: "요구사항 전체", text: "", rows: sorted });
    }
    return out;
  }, [sorted, structure]);

  const rowBlock = (row: RfpMapping) => {
    const value = pending[row.id] ?? { verdict: row.verdict, solutionCode: row.solutionCode, featureId: row.featureId };
    const autoRationale = row.engine === "rules" && row.rationale.startsWith("자동 매칭") && !rationaleEditing[row.id];
    const inlineRationale = autoRationale ? (
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground hover:text-foreground"
        title={`${row.rationale} — 클릭하면 설명을 편집합니다`}
        onClick={() => setRationaleEditing((p) => ({ ...p, [row.id]: true }))}
      >
        {row.rationale.replace(/^자동 매칭\s*[—-]\s*/, "")}
      </button>
    ) : undefined;
    return (
      <div key={row.id} className="space-y-2 rounded-md border bg-background p-3" title={row.updatedBy ? `수정 ${new Date(row.updatedAt).toLocaleString("ko-KR")}` : undefined}>
        <div className="flex items-center justify-between gap-2">
          {ruleRow(value, (next) => changeRule(row, next), row.id, inlineRationale)}
          <div className="flex shrink-0 items-center gap-1">
            {row.engine !== "manual" && (
              <span className="text-xs text-muted-foreground" title="자동 매핑이 만든 행">
                자동({ENGINE_LABEL[row.engine]}){row.score !== null && ` ${row.score.toFixed(2)}`}
              </span>
            )}
            {row.edited && <Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-label="사람이 고친 행" />}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="행 삭제" onClick={() => remove(row)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
        {!autoRationale && (
          <Textarea key={`${row.id}:rationale:${row.updatedAt}`} defaultValue={row.rationale} rows={2} placeholder="설명(왜 이 판정인지)" className="min-h-0 text-sm" autoFocus={!!rationaleEditing[row.id]} onBlur={(e) => { changeText(row, "rationale", e.target.value.trim()); setRationaleEditing((p) => { const rest = { ...p }; delete rest[row.id]; return rest; }); }} />
        )}
        <EvidenceRow
          row={row}
          feature={row.featureId ? featureIndex.get(row.featureId) : undefined}
          editing={!!urlEditing[row.id]}
          onToggleEdit={() => setUrlEditing((p) => ({ ...p, [row.id]: !p[row.id] }))}
          onSaveUrl={(v) => changeText(row, "evidenceUrl", v)}
        />
      </div>
    );
  };

  const draftBlock = (
    <div className="space-y-2 rounded-md border border-dashed bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        {ruleRow(draft ?? { verdict: "partial", solutionCode: null, featureId: null }, changeDraft, "draft")}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>취소</Button>
      </div>
      <div className="text-xs text-muted-foreground">설계·구축영역/해당없음을 고르면 바로 추가되고, 충족/부분충족/후보는 기능까지 고르면 추가됩니다. 설명·근거 URL은 추가된 뒤 입력하세요.</div>
    </div>
  );

  const multi = groups.length > 1 || groups[0]?.key !== null;
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="text-xs font-medium text-muted-foreground">
        {requirement.reqId} 솔루션 매핑 {sorted.length}행
        {multi && ` · 세부 항목 ${structure.units.length}개(매핑된 항목 ${groups.filter((g) => g.key && g.rows.length).length}개)`}
      </div>
      {groups.map((g) => (
        <div key={g.key ?? "__all"} className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 text-xs">
              {g.key ? (
                <span className="font-medium text-foreground" title={g.text || g.label}>
                  <span className="mr-1 inline-flex h-4 min-w-4 items-center justify-center rounded bg-muted px-1 text-[10px] text-muted-foreground">{g.key}</span>
                  {g.label}
                  {g.stale && <span className="ml-1 text-amber-700">(세부 내용이 바뀐 뒤 남은 매핑)</span>}
                </span>
              ) : (
                <span className="font-medium text-muted-foreground">{multi ? "요구사항 전체" : "매핑"}</span>
              )}
              <span className="ml-1 text-muted-foreground">{g.rows.length}행</span>
            </div>
            <Button size="sm" variant="outline" className="shrink-0" disabled={busy || draft !== null} onClick={() => setDraft({ verdict: "partial", solutionCode: null, featureId: null, detailKey: g.key })}>
              <Plus className="mr-1 h-4 w-4" />행 추가
            </Button>
          </div>
          {g.rows.map(rowBlock)}
          {draft && (draft.detailKey ?? null) === g.key && draftBlock}
          {!g.rows.length && !(draft && (draft.detailKey ?? null) === g.key) && (
            <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {g.key ? "이 세부 항목은 매핑이 없습니다." : "매핑이 없습니다(미매핑). \u201c행 추가\u201d로 직접 매핑하거나 개요의 \u201c솔루션 매핑 실행\u201d을 누르세요."}
            </div>
          )}
        </div>
      ))}
      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}

/**
 * 근거 표시. 기능이 있으면 주소 대신 매핑된 문서 제목(소스 페이지·파일명)과 기능 요약을 보여주고, 링크는 끝의 "바로가기"로만.
 * URL은 링크 아이콘을 눌러 펼친 입력에서 고친다. 기능이 없는 행(설계·구축영역·해당없음)은 보여줄 문서가 없어 URL 입력을 그대로 둔다.
 */
function EvidenceRow({ row, feature, editing, onToggleEdit, onSaveUrl }: {
  row: RfpMapping; feature: CatalogFeature | undefined; editing: boolean; onToggleEdit: () => void; onSaveUrl: (value: string) => void;
}) {
  const url = row.evidenceUrl ?? feature?.evidenceUrl ?? null;
  const urlInput = (
    <Input key={`${row.id}:evidence:${row.updatedAt}`} defaultValue={row.evidenceUrl ?? ""} placeholder="근거 URL" className="h-8 text-xs" onBlur={(e) => onSaveUrl(e.target.value.trim())} />
  );
  if (!feature) {
    return (
      <div className="flex items-center gap-1">
        {urlInput}
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" title="바로가기"><ExternalLink className="h-4 w-4" /></a>}
      </div>
    );
  }
  const title = feature.sourceTitle?.trim() || feature.name;
  const showFeatureName = !!feature.sourceTitle?.trim() && feature.sourceTitle.trim() !== feature.name;
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground" title={title}>
            {title}
            {showFeatureName && <span className="font-normal text-muted-foreground"> › {feature.name}</span>}
          </div>
          {/* 근거 문장(엔진이 기능 설명에서 뽑은 뒷받침 문장)이 있으면 그것을, 없으면 기능 요약을 보여준다 */}
          <div className={`line-clamp-2 ${row.evidenceText || feature.description ? "text-muted-foreground" : "italic text-muted-foreground/60"}`} title={row.evidenceText ?? feature.description}>
            {row.evidenceText ? <><span className="font-medium text-foreground">근거</span> {row.evidenceText}</> : feature.description || "요약 없음"}
          </div>
        </div>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline" title={url}>
            바로가기<ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button type="button" onClick={onToggleEdit} title={editing ? "URL 입력 닫기" : "근거 URL 편집"} className={`shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground ${editing ? "text-foreground" : "text-muted-foreground"}`}>
          {editing ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        </button>
      </div>
      {editing && <div className="flex items-center gap-1">{urlInput}</div>}
    </div>
  );
}
