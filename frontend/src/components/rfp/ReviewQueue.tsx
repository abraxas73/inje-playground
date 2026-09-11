"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CheckCheck, FileText, History, Loader2, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { VERDICT_LABEL, type CatalogSolution } from "@/lib/rfp/mapping/types";
import { indexCatalog } from "@/lib/rfp/mapping/summary";
import { buildReviewUnits, cleanRationale, reviewProgress, UNIT_STATUS_LABEL, type ReviewUnit, type UnitStatus } from "@/lib/rfp/mapping/review";
import type { ReuseSuggestion } from "@/lib/rfp/mapping/reuse";
import { VERDICT_CLASS } from "@/components/rfp/MappingSummary";
import { categoryLabel, type CategorySummaryRow } from "@/lib/rfp/category-summary";
import type { DecideResponse, ReviewDecision, ReuseResponse, RfpMapping, RfpRequirement } from "@/types/rfp";

interface Props {
  projectId: string;
  projectName: string;
  requirements: RfpRequirement[];
  mappings: RfpMapping[];
  catalog: CatalogSolution[];
  categorySummary: CategorySummaryRow[];
  onMappingsChange: (next: RfpMapping[]) => void;
}

type Filter = "open" | "all";
type Unit = ReviewUnit<RfpMapping, RfpRequirement>;

/** 단위 상태 → 색(판정 색을 그대로, 검토 대기는 후보색, 미매핑은 미매핑색) */
const STATUS_CLASS: Record<UnitStatus, string> = {
  fulfilled: VERDICT_CLASS.fulfilled,
  partial: VERDICT_CLASS.partial,
  build: VERDICT_CLASS.build,
  na: VERDICT_CLASS.na,
  pending: VERDICT_CLASS.candidate,
  unmapped: VERDICT_CLASS.unmapped,
};

const isOpen = (u: Unit) => u.status === "pending" || u.status === "unmapped";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

/** 단축키 표시 */
function Kbd({ children }: { children: string }) {
  return <kbd className="ml-1 rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

/**
 * 확정 작업(리뷰 큐). 매핑 단위(요구사항 × 세부 항목)를 하나씩 넘기며 후보 중 하나를 확정하거나 단위를 닫는다.
 *
 * 표에서 행을 펼쳐 select를 바꾸는 편집기와 달리, 이 화면은 **결정만** 한다: 후보를 읽고 → 1/2(충족/부분충족) 또는 b/n(설계·구축영역/해당없음)
 * → 다음 단위. 수백 개 후보를 키보드로 넘길 수 있어야 확정 데이터가 쌓인다(그 데이터가 재사용 제안과 카탈로그 정리의 원료다).
 * 설명·근거 URL·메모 편집은 상세 화면 편집기에서 한다.
 */
export default function ReviewQueue({ projectId, projectName, requirements, mappings, catalog, categorySummary, onMappingsChange }: Props) {
  const index = useMemo(() => indexCatalog(catalog), [catalog]);
  const units = useMemo(() => buildReviewUnits(requirements, mappings), [requirements, mappings]);
  const progress = useMemo(() => reviewProgress(units), [units]);
  const [filter, setFilter] = useState<Filter>("open");
  const visible = useMemo(() => (filter === "open" ? units.filter(isOpen) : units), [units, filter]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, ReuseSuggestion[] | null>>({});
  const listRef = useRef<HTMLDivElement>(null);

  // 현재 단위: 선택된 키가 있으면 그것(결정 뒤에도 상태가 바뀐 모습이 잠깐 보이게), 없으면 보이는 첫 단위
  const current: Unit | undefined = useMemo(() => units.find((u) => u.key === currentKey) ?? visible[0], [units, visible, currentKey]);
  const currentIdx = current ? visible.findIndex((u) => u.key === current.key) : -1;

  const goTo = useCallback((u: Unit | undefined) => {
    if (!u) return;
    setCurrentKey(u.key);
    setFocus(0);
    setError(null);
    listRef.current?.querySelector<HTMLElement>(`[data-key="${u.key}"]`)?.scrollIntoView({ block: "nearest" });
  }, []);

  /** 다음 미결 단위(현재 뒤에서 찾고 없으면 앞에서) */
  const nextOpen = useCallback((fromKey: string | null): Unit | undefined => {
    const open = units.filter(isOpen);
    if (!open.length) return undefined;
    const i = units.findIndex((u) => u.key === fromKey);
    return open.find((u) => units.indexOf(u) > i) ?? open[0];
  }, [units]);

  const decide = useCallback(async (decision: ReviewDecision) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rfp/projects/${projectId}/mapping/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decision),
      });
      if (!res.ok) throw new Error(await readError(res, "저장에 실패했습니다."));
      const j = (await res.json()) as DecideResponse;
      onMappingsChange([...mappings.filter((m) => m.requirementId !== j.requirementId), ...j.rows]);
      // 결정한 단위의 다음 미결 단위로 넘어간다
      const next = nextOpen(decision.requirementId ? `${decision.requirementId}:${decision.detailKey ?? ""}` : null);
      if (next) goTo(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, mappings, onMappingsChange, nextOpen, goTo]);

  // 이전 확정 제안 — 단위를 처음 볼 때 한 번 가져온다(null = 불러오는 중)
  useEffect(() => {
    if (!current || suggestions[current.key] !== undefined) return;
    const key = current.key;
    const u = current;
    setSuggestions((s) => ({ ...s, [key]: null }));
    const qs = new URLSearchParams({ requirementId: u.requirement.id, detailKey: u.group.key ?? "" });
    fetch(`/api/rfp/projects/${projectId}/reuse?${qs}`)
      .then(async (r) => (r.ok ? ((await r.json()) as ReuseResponse).suggestions : []))
      .catch(() => [] as ReuseSuggestion[])
      .then((list) => setSuggestions((s) => ({ ...s, [key]: list })));
  }, [current, suggestions, projectId]);

  // 단축키: j/k 후보 이동, 1/2 확정, b/n 닫기, ←/→ 단위 이동. 입력 칸에 포커스가 있으면 무시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!current) return;
      const n = current.candidates.length;
      const act = (fn: () => void) => { e.preventDefault(); fn(); };
      switch (e.key) {
        case "j": case "ArrowDown": return act(() => setFocus((f) => (n ? Math.min(n - 1, f + 1) : 0)));
        case "k": case "ArrowUp": return act(() => setFocus((f) => Math.max(0, f - 1)));
        case "ArrowRight": case " ": return act(() => goTo(visible[currentIdx + 1] ?? visible[0]));
        case "ArrowLeft": return act(() => goTo(visible[currentIdx - 1] ?? visible[visible.length - 1]));
        case "1": case "2": {
          const c = current.candidates[focus];
          if (!c || !isOpen(current)) return;
          return act(() => decide({ action: "confirm", requirementId: current.requirement.id, detailKey: current.group.key, mappingId: c.id, verdict: e.key === "1" ? "fulfilled" : "partial" }));
        }
        case "b": case "n":
          if (!isOpen(current)) return;
          return act(() => decide({ action: "close", requirementId: current.requirement.id, detailKey: current.group.key, verdict: e.key === "b" ? "build" : "na" }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, currentIdx, visible, focus, goTo, decide]);

  const pct = progress.total ? Math.round((progress.decided / progress.total) * 100) : 0;
  const detailLines = useMemo(() => (current ? current.requirement.details.split("\n").filter((l) => l.trim()) : []), [current]);
  const unitLines = useMemo(() => new Set((current?.group.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean)), [current]);

  return (
    <div className="space-y-3">
      {/* 머리: 진행률 + 필터 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="min-w-0">
          <Link href={`/rfp/${projectId}`} className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-3.5 w-3.5" />상세로</Link>
          <div className="truncate text-base font-semibold">{projectName} <span className="font-normal text-muted-foreground">· 확정 작업</span></div>
        </div>
        <div className="flex min-w-[16rem] flex-1 items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" title={`확정 ${progress.decided} / 전체 ${progress.total} 단위`}>
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="shrink-0 text-sm tabular-nums"><span className="font-semibold">{progress.decided}</span> / {progress.total} 단위 ({pct}%)</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">검토 대기 <b className="text-foreground">{progress.pending}</b> · 미매핑 <b className="text-foreground">{progress.unmapped}</b></span>
          <div className="inline-flex rounded-md border p-0.5">
            {(["open", "all"] as Filter[]).map((f) => (
              <button key={f} type="button" onClick={() => { setFilter(f); setCurrentKey(null); }} className={cn("rounded px-2 py-0.5", filter === f ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
                {f === "open" ? "미결만" : "전체"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!current ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
          {progress.total === 0 ? "매핑 단위가 없습니다. 상세 화면에서 솔루션 매핑을 먼저 실행하세요." : (
            <span className="inline-flex items-center gap-2"><CheckCheck className="h-5 w-5 text-emerald-600" />미결 단위가 없습니다 — 모두 확정됐습니다. &ldquo;전체&rdquo;로 바꾸면 확정된 단위를 다시 볼 수 있습니다.</span>
          )}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* 왼쪽: 단위 목록 */}
          <div ref={listRef} className="max-h-[75vh] overflow-y-auto rounded-lg border bg-card">
            {visible.map((u, i) => (
              <button
                key={u.key} type="button" data-key={u.key} onClick={() => goTo(u)}
                className={cn("flex w-full items-start gap-2 border-b px-3 py-2 text-left text-xs hover:bg-muted/50", u.key === current.key && "bg-muted")}
              >
                <span className={cn("mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full", STATUS_CLASS[u.status].split(" ")[0].replace("bg-", "bg-").replace("-100", "-400"))} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{u.requirement.reqId}</span>
                  {u.group.key && <span className="ml-1 text-muted-foreground">· {u.group.key}</span>}
                  <span className="block truncate text-muted-foreground" title={u.group.key ? u.group.label : u.requirement.title}>{u.group.key ? u.group.label : u.requirement.title}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
              </button>
            ))}
          </div>

          {/* 오른쪽: 현재 단위 */}
          <div className="space-y-3">
            <section className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{categoryLabel(categorySummary, current.requirement.categoryCode, current.requirement.categoryName) ?? current.requirement.categoryCode}</Badge>
                <span className="font-semibold">{current.requirement.reqId}</span>
                <span className="text-sm">{current.requirement.title}</span>
                <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[current.status])}>{UNIT_STATUS_LABEL[current.status]}</span>
              </div>
              {current.requirement.definition && <p className="mt-2 text-sm text-muted-foreground"><span className="mr-1 font-medium text-foreground">정의</span>{current.requirement.definition}</p>}
              <div className="mt-2 rounded-md bg-muted/40 p-2 text-sm">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  세부 내용{current.group.key && <> — <span className="text-foreground">항목 {current.group.key}</span>이 이 단위입니다</>}
                </div>
                {detailLines.length ? detailLines.map((l, i) => (
                  <div key={i} className={cn("whitespace-pre-wrap leading-snug", current.group.key && unitLines.has(l.trim()) ? "rounded bg-amber-100/80 px-1 font-medium" : "text-muted-foreground")}>{l}</div>
                )) : <div className="text-muted-foreground">세부 내용이 없습니다.</div>}
              </div>
            </section>

            {/* 확정된 행 */}
            {current.confirmed.length > 0 && (
              <section className="rounded-lg border bg-card p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Check className="h-3.5 w-3.5" />확정된 매핑 {current.confirmed.length}행 — 수정은 <Link href={`/rfp/${projectId}`} className="underline">상세 화면 편집기</Link>에서</div>
                <div className="divide-y">
                  {current.confirmed.map((r) => {
                    const f = r.featureId ? index.feature.get(r.featureId) : undefined;
                    return (
                      <div key={r.id} className="flex items-start gap-2 py-1.5 text-sm">
                        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", VERDICT_CLASS[r.verdict])}>{VERDICT_LABEL[r.verdict]}</span>
                        <div className="min-w-0">
                          {f && <div className="truncate">{index.solutionName.get(r.solutionCode ?? "") ?? r.solutionCode} › {f.name}</div>}
                          {cleanRationale(r.rationale) && <div className="truncate text-xs text-muted-foreground">{cleanRationale(r.rationale)}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 후보 */}
            <section className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>후보 {current.candidates.length}건 (점수순) — 하나를 골라 확정하면 나머지 후보는 지워집니다</span>
                <span className="hidden sm:inline">이동 <Kbd>j</Kbd><Kbd>k</Kbd> · 확정 <Kbd>1</Kbd><Kbd>2</Kbd> · 닫기 <Kbd>b</Kbd><Kbd>n</Kbd> · 다음 <Kbd>→</Kbd></span>
              </div>
              {current.candidates.length === 0 ? (
                <div className="text-sm text-muted-foreground">{isOpen(current) ? "후보가 없습니다. 아래에서 단위를 닫거나 상세 화면에서 행을 직접 추가하세요." : "후보가 남아 있지 않습니다."}</div>
              ) : (
                <div className="space-y-1.5">
                  {current.candidates.map((c, i) => {
                    const f = c.featureId ? index.feature.get(c.featureId) : undefined;
                    const focused = i === focus;
                    return (
                      <div
                        key={c.id} onMouseEnter={() => setFocus(i)}
                        className={cn("flex items-start gap-3 rounded-md border p-2.5 transition", focused ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "hover:bg-muted/40")}
                      >
                        <span className={cn("mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold tabular-nums", focused ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                            <span className="font-medium">{index.solutionName.get(c.solutionCode ?? "") ?? c.solutionCode}</span>
                            <span>› {f?.name ?? "(삭제된 기능)"}</span>
                            {c.score !== null && <span className="text-xs tabular-nums text-muted-foreground">점수 {c.score.toFixed(2)}</span>}
                          </div>
                          {(c.evidenceText || f?.description) && (
                            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" title={c.evidenceText ?? f?.description}>
                              {c.evidenceText ? <><span className="mr-1 rounded bg-muted px-1 text-[10px] font-medium">근거</span>{c.evidenceText}</> : f?.description}
                            </div>
                          )}
                          {f?.sourceTitle && <div className="mt-0.5 truncate text-[11px] text-muted-foreground"><FileText className="mr-1 inline h-3 w-3 align-[-2px]" />{f.sourceTitle}</div>}
                        </div>
                        {isOpen(current) && (
                          <div className="flex shrink-0 flex-col gap-1">
                            <Button size="sm" className={cn("h-7 text-xs", VERDICT_CLASS.fulfilled)} variant="ghost" disabled={busy} onClick={() => decide({ action: "confirm", requirementId: current.requirement.id, detailKey: current.group.key, mappingId: c.id, verdict: "fulfilled" })}>충족{focused && <Kbd>1</Kbd>}</Button>
                            <Button size="sm" className={cn("h-7 text-xs", VERDICT_CLASS.partial)} variant="ghost" disabled={busy} onClick={() => decide({ action: "confirm", requirementId: current.requirement.id, detailKey: current.group.key, mappingId: c.id, verdict: "partial" })}>부분충족{focused && <Kbd>2</Kbd>}</Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 이전 확정 제안(재사용) */}
            {isOpen(current) && (
              <section className="rounded-lg border bg-card p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><History className="h-3.5 w-3.5" />이전 확정 제안 — 다른 요구사항에서 사람이 확정한 매핑 중 문장이 비슷한 것</div>
                {suggestions[current.key] === null || suggestions[current.key] === undefined ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />찾는 중…</div>
                ) : suggestions[current.key]!.length === 0 ? (
                  <div className="text-xs text-muted-foreground">비슷한 확정이 아직 없습니다. 확정이 쌓이면 여기에 제안이 뜹니다.</div>
                ) : (
                  <div className="space-y-1.5">
                    {suggestions[current.key]!.map((s) => {
                      const f = s.featureId ? index.feature.get(s.featureId) : undefined;
                      return (
                        <div key={s.sourceMappingId} className="flex items-start gap-3 rounded-md border border-dashed p-2.5">
                          <div className="min-w-0 flex-1 text-sm">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", VERDICT_CLASS[s.verdict])}>{VERDICT_LABEL[s.verdict]}</span>
                              {f ? <span><span className="font-medium">{index.solutionName.get(s.solutionCode ?? "") ?? s.solutionCode}</span> › {f.name}</span> : <span className="text-muted-foreground">(기능 없음)</span>}
                              <span className="text-xs tabular-nums text-muted-foreground">유사도 {s.similarity.toFixed(2)}</span>
                            </div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground" title={`${s.projectName} ${s.reqId} ${s.title}`}>{s.projectName} · {s.reqId} {s.title}</div>
                            {cleanRationale(s.rationale) && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{cleanRationale(s.rationale)}</div>}
                          </div>
                          <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" disabled={busy} onClick={() => decide({ action: "reuse", requirementId: current.requirement.id, detailKey: current.group.key, sourceMappingId: s.sourceMappingId })}>이 확정 적용</Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* 단위 닫기·이동 */}
            <div className="flex flex-wrap items-center gap-2">
              {isOpen(current) && (
                <>
                  <Button variant="outline" size="sm" disabled={busy} className={VERDICT_CLASS.build} onClick={() => decide({ action: "close", requirementId: current.requirement.id, detailKey: current.group.key, verdict: "build" })}>설계·구축영역<Kbd>b</Kbd></Button>
                  <Button variant="outline" size="sm" disabled={busy} className={VERDICT_CLASS.na} onClick={() => decide({ action: "close", requirementId: current.requirement.id, detailKey: current.group.key, verdict: "na" })}>해당없음<Kbd>n</Kbd></Button>
                </>
              )}
              <span className="ml-auto" />
              <Button variant="ghost" size="sm" disabled={visible.length < 2} onClick={() => goTo(visible[currentIdx - 1] ?? visible[visible.length - 1])}><ArrowLeft className="mr-1 h-4 w-4" />이전</Button>
              <Button variant="ghost" size="sm" disabled={visible.length < 2} onClick={() => goTo(visible[currentIdx + 1] ?? visible[0])}>{isOpen(current) ? <><SkipForward className="mr-1 h-4 w-4" />건너뛰기</> : "다음"}<ArrowRight className="ml-1 h-4 w-4" /><Kbd>→</Kbd></Button>
            </div>
            {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />저장 중…</div>}
            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
