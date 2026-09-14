"use client";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { FIELDS, MASTER_HEADER_GROUPS, MASTER_SORT_FIELDS, visibleData, type Contact, type Field, type MasterSortField, type SortDirection } from "@/lib/marketing/types";
import { KindBadge } from "./shared";

// Same merged header ranges as 01_Master_DB: A, B:H, I:K, L:P, Q:R.
const COLUMN_GROUPS = MASTER_HEADER_GROUPS.map((group, i) => ({ ...group, widths: [
  [120], [100, 148, 76, 112, 80, 200, 128], [160, 104, 136], [80, 80, 88, 96, 96], [96, 200],
][i] }));
const GROUP_STARTS = new Set([0, 1, 8, 11, 16]);
const tableWidth = COLUMN_GROUPS.flatMap(group => group.widths).reduce((sum, width) => sum + width, 0);
const cellClass = (index: number) => `px-2 py-2 align-top whitespace-pre-wrap [overflow-wrap:anywhere]${index > 0 && GROUP_STARTS.has(index) ? " border-l" : ""}`;

export default function MasterTable({ contacts, onOpen, sort, direction, onSort, busy, selectedIds, onSelection }: { contacts: Contact[]; onOpen: (contact: Contact) => void; sort: MasterSortField; direction: SortDirection; onSort: (field: MasterSortField) => void; busy?: boolean; selectedIds?: string[]; onSelection?: (ids: string[]) => void }) {
  return <div role="region" aria-busy={busy} aria-label="Master DB 전체 컬럼 표 · 가로 스크롤" tabIndex={0} className="max-h-[70vh] w-full max-w-full overflow-auto rounded-xl border bg-card focus-visible:outline-2 focus-visible:outline-ring">
    <table className="table-fixed text-left text-sm" style={{ width: tableWidth + (onSelection ? 44 : 0) }}>
      {onSelection && <colgroup><col style={{width:44}} /></colgroup>}
      {COLUMN_GROUPS.map(group => <colgroup key={group.label}>{group.widths.map((width, i) => <col key={i} style={{ width }} />)}</colgroup>)}
      <thead className="sticky top-0 z-10 bg-muted">
        <tr>{onSelection && <th rowSpan={2} className="p-2"><input type="checkbox" aria-label="현재 페이지 Contact 전체 선택" checked={contacts.length > 0 && contacts.every(c => selectedIds?.includes(c.id))} disabled={busy} onChange={e => onSelection(e.target.checked ? [...new Set([...(selectedIds ?? []),...contacts.map(c=>c.id)])] : (selectedIds ?? []).filter(id=>!contacts.some(c=>c.id===id)))} /></th>}{COLUMN_GROUPS.map(group => <th key={group.label} scope="colgroup" colSpan={group.widths.length} className="border-b border-l px-2 py-2 text-center font-semibold first:border-l-0">{group.label}</th>)}</tr>
        <tr>{(Object.entries(MASTER_SORT_FIELDS) as [MasterSortField, string][]).map(([field, label], i) => {
          const selected = sort === field;
          const Icon = selected ? direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
          const next = selected && direction === "asc" ? "내림차순" : "오름차순";
          return <th key={field} scope="col" aria-sort={selected ? direction === "asc" ? "ascending" : "descending" : undefined} className={`${cellClass(i)} !px-0 !py-0 !align-middle font-medium ${selected ? "text-primary" : "text-muted-foreground"}`}><button type="button" aria-label={`${label} ${next} 정렬`} title={`${label} ${next} 정렬`} onClick={() => onSort(field)} className="flex min-h-12 w-full items-center gap-1 px-2 py-2 text-left hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"><span className="min-w-0">{label === "최종확인일" ? <>최종<br />확인일</> : label}</span><Icon aria-hidden="true" className={`h-3 w-3 shrink-0 ${selected ? "opacity-100" : "opacity-40"}`} /></button></th>;
        })}</tr>
      </thead>
      <tbody>{contacts.map(contact => {
        const data = visibleData(contact);
        return <tr key={contact.id} className="border-t hover:bg-muted/30">
          {onSelection && <td className="p-2"><input type="checkbox" aria-label={`${contact.db_id} 선택`} checked={selectedIds?.includes(contact.id)??false} onChange={e=>onSelection(e.target.checked?[...selectedIds??[],contact.id]:(selectedIds??[]).filter(id=>id!==contact.id))}/></td>}
          <td className={cellClass(0)}><KindBadge kind={contact.organization?.category ?? "확인 필요"} /></td>
          <td className={cellClass(1)}><button className="text-primary underline-offset-4 hover:underline" onClick={() => onOpen(contact)}>{contact.db_id}</button>{contact.needs_maintenance && <span className="mt-1 block text-xs text-amber-700">기존 데이터 정비 필요</span>}</td>
          {(Object.keys(FIELDS) as Field[]).map((field, i) => <td key={field} className={cellClass(i + 2)}>{data[field] || "—"}</td>)}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
