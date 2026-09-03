/** 표 → CSV 내려받기(브라우저). BOM을 붙여 Excel에서 한글이 깨지지 않게 한다. */
export function csvLine(values: unknown[]): string {
  return values.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

export function downloadCsv(filename: string, head: string[], rows: unknown[][]): void {
  const blob = new Blob(["﻿" + [head.join(","), ...rows.map(csvLine)].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
