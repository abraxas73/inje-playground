import { mediaNorm } from "./normalize";
import type { ImportPreview, MediaOutlet } from "@/types/media-directory";
import type { ParsedMediaSheet } from "./excel";

/** Dedupe parsed rows and compare them with the current directory (names, aliases, departments). */
export function buildImportPreview(parsed: ParsedMediaSheet, existing: MediaOutlet[], filename: string): ImportPreview {
  const byNorm = new Map<string, MediaOutlet>();
  for (const o of existing) { byNorm.set(mediaNorm(o.name), o); for (const alias of o.aliases) byNorm.set(mediaNorm(alias), o); }
  const seen = new Set<string>(); const rows: ImportPreview["rows"] = [];
  const newOutlets = new Map<string, string>(); const anyDept = new Map<string, string>();
  let duplicates = 0, newDepartments = 0, existingPairs = 0;
  for (const r of parsed.rows) {
    const on = mediaNorm(r.outlet), dn = r.department ? mediaNorm(r.department) : "";
    const key = `${on}|${dn}`;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key); rows.push({ outlet: r.outlet, department: r.department });
    const found = byNorm.get(on);
    if (!found && !newOutlets.has(on)) newOutlets.set(on, r.outlet);
    if (!r.department) { if ((!found || !found.any_department) && !anyDept.has(on)) anyDept.set(on, found?.name ?? r.outlet); continue; }
    if (found?.departments.some((d) => mediaNorm(d.name) === dn)) existingPairs++; else newDepartments++;
  }
  return { filename, rows, total: parsed.total, blank: parsed.blank, duplicates, invalid: parsed.invalid, newOutlets: [...newOutlets.values()], newDepartments, existingPairs, anyDepartmentOutlets: [...anyDept.values()] };
}
