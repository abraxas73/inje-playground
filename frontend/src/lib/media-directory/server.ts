import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaNorm } from "./normalize";
import type { MediaDepartment, MediaDirectoryResponse, MediaOutlet } from "@/types/media-directory";

/** Whole directory (well under the 1,000-row PostgREST cap: ~70 outlets / ~100 departments). */
export async function loadDirectory(supabase: SupabaseClient, q = ""): Promise<MediaDirectoryResponse> {
  const [outlets, departments] = await Promise.all([
    supabase.from("media_outlets").select("id,name,aliases,any_department,active,updated_at").order("name"),
    supabase.from("media_departments").select("id,outlet_id,name,active,updated_at").order("name"),
  ]);
  if (outlets.error || departments.error) throw new Error("매체·부서 목록을 불러오지 못했습니다.");
  const grouped = new Map<string, MediaDepartment[]>();
  for (const d of (departments.data ?? []) as MediaDepartment[]) grouped.set(d.outlet_id, [...(grouped.get(d.outlet_id) ?? []), d]);
  let list: MediaOutlet[] = ((outlets.data ?? []) as Omit<MediaOutlet, "departments">[]).map((o) => ({ ...o, departments: grouped.get(o.id) ?? [] }));
  const norm = mediaNorm(q.trim().slice(0, 100));
  if (norm) list = list.filter((o) => mediaNorm(o.name).includes(norm) || o.aliases.some((a) => mediaNorm(a).includes(norm)) || o.departments.some((d) => mediaNorm(d.name).includes(norm)));
  return { outlets: list, totals: { outlets: outlets.data?.length ?? 0, activeOutlets: ((outlets.data ?? []) as { active: boolean }[]).filter((o) => o.active).length, departments: departments.data?.length ?? 0 } };
}

const STATUS: Record<string, [number, string]> = {
  "42501": [403, "관리자 권한이 필요합니다."], "22023": [400, "입력값을 확인해 주세요."],
  "23505": [409, "이미 같은 이름이나 별칭이 등록되어 있습니다."], P0002: [404, "대상을 찾을 수 없습니다."],
};
export function rpcErrorResponse(error: { code?: string; message?: string } | null): NextResponse {
  const [status, message] = STATUS[error?.code ?? ""] ?? [500, "저장하지 못했습니다. 잠시 후 다시 시도해 주세요."];
  return NextResponse.json({ error: message }, { status });
}
export const noStore = { headers: { "Cache-Control": "private, no-store" } };
export const cleanName = (value: unknown, max = 100) => (typeof value === "string" ? value.trim().slice(0, max) : "");
