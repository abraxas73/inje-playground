"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export interface Column<T> {
  key: string;
  header: string;
  value: (row: T) => number | string | null;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

export default function SortableTable<T>({ rows, columns, rowKey, defaultSort, emptyText = "데이터가 없습니다.", rowClassName }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  defaultSort: { key: string; dir: "asc" | "desc" };
  emptyText?: string;
  rowClassName?: (row: T) => string;
}) {
  const [sort, setSort] = useState(defaultSort);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ko") * dir;
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                onClick={() => toggle(c.key)}
                className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}
              >
                <span className="inline-flex items-center gap-0.5">
                  {c.header}
                  {sort.key === c.key && (sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-2 py-6 text-center text-muted-foreground">{emptyText}</td>
            </tr>
          ) : (
            sorted.map((r) => (
              <tr key={rowKey(r)} className={`border-t ${rowClassName?.(r) ?? ""}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 tabular-nums ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}>
                    {c.render ? c.render(r) : (c.value(r) ?? "—")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
