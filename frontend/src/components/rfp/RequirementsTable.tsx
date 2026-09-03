"use client";

import { useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { ArrowUpDown, Plus, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import EditableCell from "@/components/rfp/EditableCell";
import { orderCategoryCodes, sheetNameFor } from "@/lib/rfp/requirements";
import type { RfpRequirement } from "@/types/rfp";

interface Props {
  projectId: string;
  requirements: RfpRequirement[];
  onChange: (next: RfpRequirement[]) => void;
}

type EditableField = "categoryName" | "reqId" | "title" | "definition" | "details" | "deliverables" | "related" | "solution";

async function patchRequirement(id: string, patch: Partial<Record<EditableField, string>>): Promise<RfpRequirement> {
  const res = await fetch(`/api/rfp/requirements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  const json = (await res.json().catch(() => ({}))) as RfpRequirement & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "저장에 실패했습니다.");
  return json;
}

export default function RequirementsTable({ projectId, requirements, onChange }: Props) {
  const codes = useMemo(() => orderCategoryCodes(requirements.map((r) => r.categoryCode)), [requirements]);
  const sheetIndex = useMemo(() => new Map(codes.map((c, i) => [c, i + 2])), [codes]);
  const categoryNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of requirements) if (!m.has(r.categoryCode)) m.set(r.categoryCode, r.categoryName);
    return m;
  }, [requirements]);
  const [tab, setTab] = useState("all");
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<RfpRequirement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = (row: RfpRequirement, field: EditableField) => async (next: string) => {
    const updated = await patchRequirement(row.id, { [field]: next });
    onChange(requirements.map((r) => (r.id === row.id ? updated : r)));
  };

  const removeRow = async (row: RfpRequirement) => {
    const res = await fetch(`/api/rfp/requirements/${row.id}`, { method: "DELETE" });
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "삭제에 실패했습니다."); return; }
    onChange(requirements.filter((r) => r.id !== row.id));
  };

  const col = createColumnHelper<RfpRequirement>();
  const editable = (field: EditableField, header: string, opts: { clamp?: number; width?: string } = {}) =>
    col.accessor(field, {
      header,
      cell: (ctx) => <EditableCell value={ctx.getValue()} onSave={save(ctx.row.original, field)} clampLines={opts.clamp ?? 3} />,
      meta: { width: opts.width },
    });
  const actions = col.display({
    id: "actions",
    header: "",
    cell: (ctx) => <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="행 삭제" onClick={() => setDeleting(ctx.row.original)}><Trash2 className="h-4 w-4" /></Button>,
    meta: { width: "3rem" },
  });
  const seq = col.display({ id: "seq", header: "연번", cell: (ctx) => <span className="tabular-nums text-muted-foreground">{ctx.row.index + 1}</span>, meta: { width: "3.5rem" } });

  const allColumns = useMemo(() => [
    seq,
    editable("categoryName", "요구사항 구분", { clamp: 0, width: "11rem" }),
    editable("reqId", "요구사항 ID", { clamp: 0, width: "8rem" }),
    editable("title", "요구사항 명칭", { clamp: 0, width: "20rem" }),
    col.display({ id: "sheet", header: "상세 시트 위치", cell: (ctx) => <span className="text-muted-foreground">{sheetNameFor(ctx.row.original.categoryCode, sheetIndex.get(ctx.row.original.categoryCode) ?? 0)}</span>, meta: { width: "8rem" } }),
    editable("solution", "당사 솔루션", { clamp: 2, width: "14rem" }),
    actions,
  ], [sheetIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const detailColumns = useMemo(() => [
    seq,
    editable("reqId", "요구사항 ID", { clamp: 0, width: "8rem" }),
    editable("title", "요구사항명", { clamp: 0, width: "14rem" }),
    editable("definition", "정의", { clamp: 3, width: "14rem" }),
    editable("details", "세부 내용", { clamp: 3, width: "34rem" }),
    editable("deliverables", "산출정보", { clamp: 3, width: "10rem" }),
    editable("related", "관련요구사항", { clamp: 3, width: "14rem" }),
    actions,
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => (tab === "all" ? requirements : requirements.filter((r) => r.categoryCode === tab)), [requirements, tab]);
  const table = useReactTable({
    data,
    columns: tab === "all" ? allColumns : detailColumns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _id, value: string) => {
      const q = value.toLowerCase();
      const r = row.original;
      return [r.reqId, r.title, r.categoryName, r.definition, r.details, r.deliverables, r.related, r.solution].some((s) => s.toLowerCase().includes(q));
    },
  });

  return (
    <div className="space-y-3">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="all">전체 목록 <span className="ml-1 text-xs text-muted-foreground">{requirements.length}</span></TabsTrigger>
            {codes.map((c) => (
              <TabsTrigger key={c} value={c}>{c} <span className="ml-1 text-xs text-muted-foreground">{requirements.filter((r) => r.categoryCode === c).length}</span></TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="ID·명칭·내용 검색" className="h-8 w-56" />
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
                      <th key={h.id} style={{ width: (h.column.columnDef.meta as { width?: string } | undefined)?.width }} className="px-2 py-2 align-middle">
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
                  <tr key={row.id} className="border-t align-top hover:bg-muted/20" title={row.original.updatedBy ? `수정 ${new Date(row.original.updatedAt).toLocaleString("ko-KR")}` : undefined}>
                    {row.getVisibleCells().map((cell) => <td key={cell.id} className="px-2 py-1.5">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
                  </tr>
                ))}
                {table.getRowModel().rows.length === 0 && <tr><td colSpan={99} className="px-3 py-8 text-center text-muted-foreground">표시할 요구사항이 없습니다.</td></tr>}
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
            <AlertDialogDescription>{deleting?.title}</AlertDialogDescription>
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
