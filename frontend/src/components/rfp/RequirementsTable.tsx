"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import {
  createColumnHelper, flexRender, getCoreRowModel, getExpandedRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ExpandedState, type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import EditableCell from "@/components/rfp/EditableCell";
import MappingEditor from "@/components/rfp/MappingEditor";
import { VERDICT_CLASS, VerdictBadge, type VerdictFilter } from "@/components/rfp/MappingSummary";
import { cn } from "@/lib/utils";
import { orderCategoryCodes, sheetNameFor } from "@/lib/rfp/requirements";
import { bestVerdict, groupByRequirement, indexCatalog, mappingSummary } from "@/lib/rfp/mapping/summary";
import { UNMAPPED_LABEL, VERDICT_LABEL, type CatalogSolution } from "@/lib/rfp/mapping/types";
import { categoryLabel, findCategorySummary, type CategorySummaryRow } from "@/lib/rfp/category-summary";
import type { RfpMapping, RfpMappingStatus, RfpRequirement } from "@/types/rfp";

interface Props {
  projectId: string;
  requirements: RfpRequirement[];
  mappings: RfpMapping[];
  catalog: CatalogSolution[];
  mappingStatus: RfpMappingStatus;
  /** 요구사항 총괄표 행 — 구분 탭에 분류명을 붙이고 검색에도 쓴다(없으면 요구사항 행의 구분 셀로 대체) */
  categorySummary: CategorySummaryRow[];
  verdictFilter: VerdictFilter;
  onChange: (next: RfpRequirement[]) => void;
  onMappingsChange: (next: RfpMapping[]) => void;
}

type EditableField = "categoryName" | "reqId" | "title" | "definition" | "details" | "deliverables" | "related";

async function patchRequirement(id: string, patch: Partial<Record<EditableField, string>>): Promise<RfpRequirement> {
  const res = await fetch(`/api/rfp/requirements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  const json = (await res.json().catch(() => ({}))) as RfpRequirement & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "저장에 실패했습니다.");
  return json;
}

export default function RequirementsTable({ projectId, requirements, mappings, catalog, mappingStatus, categorySummary, verdictFilter, onChange, onMappingsChange }: Props) {
  /** 매핑이 한 번 끝났으면(또는 매핑 행이 있으면) 요구사항 ID를 판정 색 버튼으로 그린다 */
  const mapped = mappingStatus === "ready" || mappings.length > 0;
  const codes = useMemo(() => orderCategoryCodes(requirements.map((r) => r.categoryCode)), [requirements]);
  const sheetIndex = useMemo(() => new Map(codes.map((c, i) => [c, i + 2])), [codes]);
  const categoryNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of requirements) if (!m.has(r.categoryCode)) m.set(r.categoryCode, r.categoryName);
    return m;
  }, [requirements]);
  const countByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of requirements) m.set(r.categoryCode, (m.get(r.categoryCode) ?? 0) + 1);
    return m;
  }, [requirements]);
  /** 구분 코드 → 탭 이름(총괄표 우선, 없으면 행의 구분 셀) · 검색용 원문(국/영) */
  const codeLabels = useMemo(() => {
    const m = new Map<string, { label: string | null; search: string }>();
    for (const c of codes) {
      const row = findCategorySummary(categorySummary, c);
      m.set(c, { label: categoryLabel(categorySummary, c, categoryNames.get(c)), search: [row?.name, row?.nameEn].filter(Boolean).join(" ") });
    }
    return m;
  }, [codes, categorySummary, categoryNames]);
  const index = useMemo(() => indexCatalog(catalog), [catalog]);
  const groups = useMemo(() => groupByRequirement(mappings), [mappings]);
  const [tab, setTab] = useState("all");
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<RfpRequirement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback((row: RfpRequirement, field: EditableField) => async (next: string) => {
    const updated = await patchRequirement(row.id, { [field]: next });
    onChange(requirements.map((r) => (r.id === row.id ? updated : r)));
  }, [requirements, onChange]);

  const removeRow = async (row: RfpRequirement) => {
    const res = await fetch(`/api/rfp/requirements/${row.id}`, { method: "DELETE" });
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "삭제에 실패했습니다."); return; }
    onChange(requirements.filter((r) => r.id !== row.id));
    onMappingsChange(mappings.filter((m) => m.requirementId !== row.id));
  };

  /** 요구사항 하나의 매핑 행이 바뀌면 전체 목록에서 그 요구사항 행만 교체 */
  const replaceMappingsFor = useCallback((requirementId: string, rows: RfpMapping[]) => {
    onMappingsChange([...mappings.filter((m) => m.requirementId !== requirementId), ...rows]);
  }, [mappings, onMappingsChange]);

  // save·groups·index가 바뀔 때마다 컬럼을 다시 만든다(편집 콜백이 옛 requirements를 캡처하지 않게 — 1단계와 같은 이유)
  const { allColumns, detailColumns } = useMemo(() => {
    const col = createColumnHelper<RfpRequirement>();
    const editable = (field: EditableField, header: string, opts: { clamp?: number; width?: string } = {}) =>
      col.accessor(field, {
        header,
        cell: (ctx) => <EditableCell value={ctx.getValue()} onSave={save(ctx.row.original, field)} clampLines={opts.clamp ?? 3} />,
        meta: { width: opts.width },
      });
    const expander = col.display({
      id: "expand",
      header: "",
      cell: (ctx) => (
        <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="솔루션 매핑 펼치기" onClick={ctx.row.getToggleExpandedHandler()}>
          {ctx.row.getIsExpanded() ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      ),
      meta: { width: "2rem" },
    });
    const actions = col.display({
      id: "actions",
      header: "",
      cell: (ctx) => <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="행 삭제" onClick={() => setDeleting(ctx.row.original)}><Trash2 className="h-4 w-4" /></Button>,
      meta: { width: "3rem" },
    });
    const seq = col.display({ id: "seq", header: "연번", cell: (ctx) => <span className="tabular-nums text-muted-foreground">{ctx.row.index + 1}</span>, meta: { width: "3.5rem" } });
    // 매핑 전에는 다른 셀처럼 클릭해서 편집. 매핑 후에는 판정 색 버튼(클릭 → 행 펼침)이 되고 ID 편집은 펼친 패널 헤더에서 한다.
    const reqIdCol = col.accessor("reqId", {
      header: "요구사항 ID",
      cell: (ctx) => {
        if (!mapped) return <EditableCell value={ctx.getValue()} onSave={save(ctx.row.original, "reqId")} clampLines={0} />;
        const verdict = bestVerdict(groups.get(ctx.row.original.id) ?? []) ?? "unmapped";
        const label = verdict === "unmapped" ? UNMAPPED_LABEL : VERDICT_LABEL[verdict];
        const open = ctx.row.getIsExpanded();
        return (
          <button
            type="button"
            onClick={ctx.row.getToggleExpandedHandler()}
            aria-expanded={open}
            title={`${label} — 클릭하면 솔루션 매핑을 ${open ? "접습니다" : "펼칩니다"}. ID 편집은 펼친 패널에서.`}
            className={cn("inline-flex max-w-full items-center rounded-md border border-transparent px-2 py-0.5 text-left text-sm font-medium tabular-nums ring-offset-background transition", VERDICT_CLASS[verdict], open && "ring-2 ring-ring ring-offset-1")}
          >
            <span className="truncate">{ctx.getValue() || "ID 없음"}</span>
          </button>
        );
      },
      meta: { width: "8rem" },
    });
    const solution = col.display({
      id: "solution",
      header: "당사 솔루션",
      cell: (ctx) => {
        const g = groups.get(ctx.row.original.id) ?? [];
        const best = bestVerdict(g);
        return (
          <div className="space-y-1">
            <VerdictBadge verdict={best ?? "unmapped"} />
            {g.length > 0 && <div className="line-clamp-2 text-xs text-muted-foreground">{mappingSummary(g, index)}</div>}
          </div>
        );
      },
      meta: { width: "16rem" },
    });

    return {
      allColumns: [
        expander,
        seq,
        editable("categoryName", "요구사항 구분", { clamp: 0, width: "11rem" }),
        reqIdCol,
        editable("title", "요구사항 명칭", { clamp: 0, width: "20rem" }),
        col.display({ id: "sheet", header: "상세 시트 위치", cell: (ctx) => <span className="text-muted-foreground">{sheetNameFor(ctx.row.original.categoryCode, sheetIndex.get(ctx.row.original.categoryCode) ?? 0)}</span>, meta: { width: "8rem" } }),
        solution,
        actions,
      ],
      detailColumns: [
        expander,
        seq,
        reqIdCol,
        editable("title", "요구사항명", { clamp: 0, width: "14rem" }),
        editable("definition", "정의", { clamp: 3, width: "14rem" }),
        editable("details", "세부 내용", { clamp: 3, width: "30rem" }),
        editable("deliverables", "산출정보", { clamp: 3, width: "10rem" }),
        editable("related", "관련요구사항", { clamp: 3, width: "12rem" }),
        solution,
        actions,
      ],
    };
  }, [save, sheetIndex, groups, index, mapped]);

  const data = useMemo(() => {
    const byTab = tab === "all" ? requirements : requirements.filter((r) => r.categoryCode === tab);
    if (!verdictFilter) return byTab;
    return byTab.filter((r) => (bestVerdict(groups.get(r.id) ?? []) ?? "unmapped") === verdictFilter);
  }, [requirements, tab, verdictFilter, groups]);

  const table = useReactTable({
    data,
    columns: tab === "all" ? allColumns : detailColumns,
    state: { sorting, globalFilter: filter, expanded },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    onExpandedChange: setExpanded,
    getRowId: (r) => r.id,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    globalFilterFn: (row, _id, value: string) => {
      const q = value.toLowerCase();
      const r = row.original;
      const summary = mappingSummary(groups.get(r.id) ?? [], index);
      const cat = codeLabels.get(r.categoryCode);
      return [r.reqId, r.title, r.categoryName, cat?.label ?? "", cat?.search ?? "", r.definition, r.details, r.deliverables, r.related, summary].some((s) => s.toLowerCase().includes(q));
    },
  });
  const colCount = (tab === "all" ? allColumns : detailColumns).length;
  // 열 폭은 rem 비율 → %로 환산해 표가 컨테이너를 넘지 않게 한다(고정 rem 합이 화면보다 크면 표가 옆으로 스크롤되고 펼친 행의 매핑 패널까지 잘렸다)
  const widthPct = useMemo(() => {
    const cols = tab === "all" ? allColumns : detailColumns;
    const rems = cols.map((c) => parseFloat(String(c.meta?.width ?? "8rem")) || 8);
    const total = rems.reduce((a, b) => a + b, 0);
    return new Map(cols.map((c, i) => [c.id ?? (c as { accessorKey?: string }).accessorKey ?? String(i), `${((rems[i] / total) * 100).toFixed(2)}%`]));
  }, [tab, allColumns, detailColumns]);

  return (
    <div className="space-y-3">
      <Tabs value={tab} onValueChange={setTab}>
        {/* 구분이 20개를 넘으면 탭이 두 줄로 접힌다. TabsList 기본 고정 높이(h-9)를 풀어야(!) 둘째 줄이 상자 밖으로 넘치지 않고, 트리거는 flex-1로 늘어나지 않게, 검색·행 추가는 오른쪽 고정 폭. */}
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <TabsList className="h-auto! min-w-0 flex-wrap justify-start gap-0.5">
            <TabsTrigger value="all" className="flex-none">전체 목록 <span className="ml-1 text-xs text-muted-foreground">{requirements.length}</span></TabsTrigger>
            {codes.map((c) => {
              const label = codeLabels.get(c)?.label;
              return (
                <TabsTrigger key={c} value={c} className="flex-none" title={label ? `${c} · ${label}` : c}>
                  {c}
                  {label && <span className="ml-1 text-xs font-normal text-muted-foreground">{label}</span>}
                  <span className="ml-1 text-xs text-muted-foreground">{countByCode.get(c) ?? 0}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          <div className="flex shrink-0 items-center gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="ID·명칭·내용·솔루션 검색" className="h-8 w-56" />
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />행 추가</Button>
          </div>
        </div>
        <TabsContent value={tab} forceMount className="mt-3">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th key={h.id} style={{ width: widthPct.get(h.column.id) ?? h.column.columnDef.meta?.width }} className="px-2 py-2 align-middle">
                        {h.column.getCanSort() ? (
                          <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                            {flexRender(h.column.columnDef.header, h.getContext())}<ArrowUpDown className="h-3 w-3" />
                          </button>
                        ) : flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-t align-top hover:bg-muted/20" title={row.original.updatedBy ? `수정 ${new Date(row.original.updatedAt).toLocaleString("ko-KR")}` : undefined}>
                      {row.getVisibleCells().map((cell) => <td key={cell.id} className="px-2 py-1.5">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
                    </tr>
                    {row.getIsExpanded() && (
                      <tr className="border-t bg-muted/10">
                        <td colSpan={colCount} className="px-3 py-2">
                          <RequirementDetails requirement={row.original} onSaveReqId={save(row.original, "reqId")} />
                          <MappingEditor
                            projectId={projectId}
                            requirement={row.original}
                            rows={groups.get(row.original.id) ?? []}
                            catalog={catalog}
                            onChange={(rows) => replaceMappingsFor(row.original.id, rows)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {table.getRowModel().rows.length === 0 && <tr><td colSpan={colCount} className="px-3 py-8 text-center text-muted-foreground">표시할 요구사항이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
      {error && <div className="text-sm text-destructive">{error}</div>}

      <AddRowDialog
        open={adding}
        onClose={() => setAdding(false)}
        projectId={projectId}
        codes={codes}
        categoryNames={categoryNames}
        defaultCode={tab === "all" ? codes[0] ?? "SER" : tab}
        onCreated={(row) => { onChange([...requirements, row]); setAdding(false); }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>요구사항 {deleting?.reqId}을(를) 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>{deleting?.title} — 이 요구사항의 솔루션 매핑도 함께 지워집니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (deleting) await removeRow(deleting); setDeleting(null); }}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 펼친 행 위쪽: 매핑을 확인할 때 요구사항 본문(정의·세부 내용·산출정보·관련 요구사항)을 같이 본다 — 전체 목록 탭에는 이 내용이 열로 없다. 본문 편집은 구분 탭의 셀에서, ID는 여기 헤더에서(매핑 후 ID 셀이 버튼이 되므로). */
function RequirementDetails({ requirement, onSaveReqId }: { requirement: RfpRequirement; onSaveReqId: (next: string) => Promise<void> }) {
  const fields = ([
    ["정의", requirement.definition],
    ["세부 내용", requirement.details],
    ["산출정보", requirement.deliverables],
    ["관련 요구사항", requirement.related],
  ] as [string, string][]).filter(([, v]) => v.trim());
  return (
    <div className="mb-3 rounded-lg border bg-background p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 text-xs font-medium text-muted-foreground">
        <EditableCell value={requirement.reqId} onSave={onSaveReqId} clampLines={0} placeholder="ID 없음" className="rounded px-1 -mx-1 hover:bg-muted" />
        <span>· {requirement.title}</span>
      </div>
      {fields.length === 0 ? (
        <div className="text-sm text-muted-foreground">세부 내용이 없습니다.</div>
      ) : (
        <dl className="grid gap-x-4 gap-y-2 text-sm md:grid-cols-[7rem_minmax(0,1fr)]">
          {fields.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-xs font-medium text-muted-foreground md:pt-0.5">{label}</dt>
              <dd className="whitespace-pre-wrap break-words">{value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

function AddRowDialog({ open, onClose, projectId, codes, categoryNames, defaultCode, onCreated }: {
  open: boolean; onClose: () => void; projectId: string; codes: string[]; categoryNames: Map<string, string>; defaultCode: string; onCreated: (row: RfpRequirement) => void;
}) {
  const [code, setCode] = useState(defaultCode);
  const [name, setName] = useState(categoryNames.get(defaultCode) ?? "");
  const [reqId, setReqId] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rfp/projects/${projectId}/requirements`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryCode: code.trim().toUpperCase(), categoryName: name.trim() || code, reqId: reqId.trim() || undefined, title: title.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as RfpRequirement & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "추가에 실패했습니다.");
      onCreated(json);
      setReqId(""); setTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>요구사항 행 추가</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>구분 코드</Label>
            <Input list="rfp-codes" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); const n = categoryNames.get(e.target.value.toUpperCase()); if (n) setName(n); }} placeholder="SER" />
            <datalist id="rfp-codes">{codes.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="grid gap-1"><Label>구분명</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="서비스 요구사항" /></div>
          <div className="grid gap-1"><Label>요구사항 ID <span className="text-xs text-muted-foreground">(비우면 다음 번호 자동)</span></Label><Input value={reqId} onChange={(e) => setReqId(e.target.value)} placeholder={`${code || "SER"}-0xx`} /></div>
          <div className="grid gap-1"><Label>요구사항 명칭</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>닫기</Button>
          <Button disabled={busy || !code.trim()} onClick={submit}>추가</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
