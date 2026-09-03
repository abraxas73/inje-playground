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
  /**
   * 총계 행 값. "sum"이면 value()의 숫자 합(천 단위 구분), 함수면 현재(필터된) 행 전체로 계산한 표시값.
   * 평균·비율 컬럼은 합을 다시 나누는 함수를 준다. 하나라도 있으면 표 하단에 총계 행이 붙는다.
   */
  total?: "sum" | ((rows: T[]) => ReactNode);
}

/** 총계 계산용 합계 */
export const sumBy = <T,>(rows: T[], f: (row: T) => number | null | undefined): number => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);

function defaultCell(v: number | string | null): ReactNode {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  return v;
}

export default function SortableTable<T>({ rows, columns, rowKey, defaultSort, emptyText = "데이터가 없습니다.", rowClassName, totalLabel }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  defaultSort: { key: string; dir: "asc" | "desc" };
  emptyText?: string;
  rowClassName?: (row: T) => string;
  /** 총계 행 첫 칸 라벨(기본 "총계 (N)"). total이 있는 컬럼이 없으면 총계 행은 나오지 않는다 */
  totalLabel?: string;
}) {
  const hasTotals = columns.some((c) => c.total);
  const totalCell = (c: Column<T>, idx: number): ReactNode => {
    if (c.total === "sum") return defaultCell(sumBy(rows, (r) => { const v = c.value(r); return typeof v === "number" ? v : 0; }));
    if (typeof c.total === "function") return c.total(rows);
    return idx === 0 ? (totalLabel ?? `총계 (${rows.length.toLocaleString("ko-KR")})`) : "";
  };
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
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(c.key);
                  }
                }}
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
                    {c.render ? c.render(r) : defaultCell(c.value(r))}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {hasTotals && rows.length > 0 && (
          <tfoot className="border-t-2 bg-muted/40 font-medium">
            <tr>
              {columns.map((c, i) => (
                <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 tabular-nums ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}>
                  {totalCell(c, i)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
