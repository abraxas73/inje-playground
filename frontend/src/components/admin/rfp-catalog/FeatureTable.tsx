"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { ArrowUpDown, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import EditableCell from "@/components/rfp/EditableCell";
import type { RfpAdminFeature, RfpAdminSolution } from "@/types/rfp";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

export default function FeatureTable({ solution, refreshKey, onChanged }: { solution: RfpAdminSolution; refreshKey: number; onChanged: () => void }) {
  const [features, setFeatures] = useState<RfpAdminFeature[]>([]);
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}/features`);
    const json = (await res.json().catch(() => ({}))) as { features?: RfpAdminFeature[]; error?: string };
    if (!res.ok) { setError(json.error ?? "기능을 불러오지 못했습니다."); return; }
    setFeatures(json.features ?? []);
  }, [solution.code]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const patch = useCallback(async (row: RfpAdminFeature, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/rfp-catalog/features/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await readError(res, "저장에 실패했습니다."));
    const updated = (await res.json()) as RfpAdminFeature;
    setFeatures((cur) => cur.map((f) => (f.id === row.id ? updated : f)));
    onChanged();
  }, [onChanged]);

  const remove = async (row: RfpAdminFeature) => {
    if (!window.confirm(`기능 "${row.name}"을(를) 삭제할까요? 매핑이 참조하면 삭제되지 않습니다.`)) return;
    setError(null);
    const res = await fetch(`/api/admin/rfp-catalog/features/${row.id}`, { method: "DELETE" });
    if (!res.ok) { setError(await readError(res, "삭제에 실패했습니다.")); return; }
    setFeatures((cur) => cur.filter((f) => f.id !== row.id));
    onChanged();
  };

  // patch가 바뀔 때마다 컬럼을 다시 만든다(그렇지 않으면 편집 콜백이 옛 행을 캡처한다 — 1단계 RequirementsTable과 같은 이유)
  const columns = useMemo(() => {
    const col = createColumnHelper<RfpAdminFeature>();
    return [
      col.accessor("sortOrder", {
        header: "순서",
        cell: (ctx) => (
          <Input
            type="number"
            defaultValue={ctx.getValue()}
            className="h-7 w-16 px-1 text-xs"
            onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== ctx.getValue()) patch(ctx.row.original, { sortOrder: n }).catch((err) => setError(err instanceof Error ? err.message : "저장 실패")); }}
          />
        ),
        meta: { width: "4.5rem" },
      }),
      col.accessor("name", {
        header: "기능",
        cell: (ctx) => (
          <div className="flex items-start gap-1">
            <EditableCell value={ctx.getValue()} onSave={(v) => patch(ctx.row.original, { name: v })} clampLines={0} className="min-w-0 flex-1 font-medium" />
            {ctx.row.original.edited && <Pencil className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" aria-label="사람이 고친 항목" />}
          </div>
        ),
        meta: { width: "14rem" },
      }),
      col.accessor("description", { header: "설명", cell: (ctx) => <EditableCell value={ctx.getValue()} onSave={(v) => patch(ctx.row.original, { description: v })} clampLines={3} /> }),
      col.accessor("evidenceUrl", {
        header: "근거 URL",
        cell: (ctx) => (
          <div className="flex items-start gap-1">
            <EditableCell value={ctx.getValue() ?? ""} onSave={(v) => patch(ctx.row.original, { evidenceUrl: v || null })} clampLines={1} placeholder="URL" className="min-w-0 flex-1 text-xs" />
            {ctx.getValue() && <a href={ctx.getValue()!} target="_blank" rel="noopener noreferrer" className="mt-1 text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" /></a>}
          </div>
        ),
        meta: { width: "14rem" },
      }),
      col.accessor("isActive", {
        header: "활성",
        cell: (ctx) => <Switch checked={ctx.getValue()} onCheckedChange={(v) => patch(ctx.row.original, { isActive: v }).catch((err) => setError(err instanceof Error ? err.message : "저장 실패"))} />,
        meta: { width: "4rem" },
      }),
      col.accessor("mappingCount", { header: "매핑", cell: (ctx) => <span className="tabular-nums text-muted-foreground">{ctx.getValue()}</span>, meta: { width: "3.5rem" } }),
      col.display({
        id: "actions", header: "",
        cell: (ctx) => <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="삭제" onClick={() => remove(ctx.row.original)}><Trash2 className="h-4 w-4" /></Button>,
        meta: { width: "3rem" },
      }),
    ];
  }, [patch]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useReactTable({
    data: features,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (r) => r.id,
    globalFilterFn: (row, _id, value: string) => {
      const q = value.toLowerCase();
      return [row.original.name, row.original.description, row.original.evidenceUrl ?? ""].some((s) => s.toLowerCase().includes(q));
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">기능 <span className="font-normal text-muted-foreground">{features.length}</span></h3>
        <div className="flex items-center gap-2">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="이름·설명 검색" className="h-8 w-48" />
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />기능 추가</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">✎ 표시는 사람이 고친 항목입니다. 가져오기는 이 항목을 덮어쓰지 않습니다. 매핑이 참조하는 기능은 삭제 대신 비활성으로 바꾸세요.</p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} style={{ width: h.column.columnDef.meta?.width }} className="px-2 py-2 align-middle">
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
              <tr key={row.id} className="border-t align-top hover:bg-muted/20">
                {row.getVisibleCells().map((cell) => <td key={cell.id} className="px-2 py-1.5">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
              </tr>
            ))}
            {!table.getRowModel().rows.length && <tr><td colSpan={99} className="px-3 py-8 text-center text-muted-foreground">기능이 없습니다. Confluence 소스를 가져오거나 직접 추가하세요.</td></tr>}
          </tbody>
        </table>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <AddFeatureDialog open={adding} onClose={() => setAdding(false)} solutionCode={solution.code} onCreated={(f) => { setFeatures((cur) => [...cur, f]); setAdding(false); onChanged(); }} />
    </div>
  );
}

function AddFeatureDialog({ open, onClose, solutionCode, onCreated }: { open: boolean; onClose: () => void; solutionCode: string; onCreated: (f: RfpAdminFeature) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rfp-catalog/solutions/${solutionCode}/features`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), description: description.trim(), evidenceUrl: evidenceUrl.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await readError(res, "추가에 실패했습니다."));
      onCreated((await res.json()) as RfpAdminFeature);
      setName(""); setDescription(""); setEvidenceUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>기능 추가</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1"><Label>기능 이름 <span className="text-xs text-muted-foreground">(40자 이내)</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1"><Label>설명</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
          <div className="grid gap-1"><Label>근거 URL</Label><Input value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="https://…" /></div>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>닫기</Button>
          <Button disabled={busy || !name.trim()} onClick={submit}>추가</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
