import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { parseMembersCsv, parseMembersFilename } from "@/lib/claude-usage/members-csv";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { data, error } = await c.admin
    .from("claude_csv_imports")
    .select("id, org_id, period_start, period_end, filename, row_count, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imports: data ?? [] });
}

/** POST multipart: files[] (+ orgId/periodStart/periodEnd — 파일 1개일 때 파일명 대체) */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  const orgIdField = typeof form.get("orgId") === "string" ? (form.get("orgId") as string).trim().toLowerCase() : "";
  const ps = form.get("periodStart");
  const pe = form.get("periodEnd");
  const override =
    files.length === 1 && orgIdField && isYmd(typeof ps === "string" ? ps : null) && isYmd(typeof pe === "string" ? pe : null)
      ? { orgId: orgIdField, periodStart: ps as string, periodEnd: pe as string }
      : null;

  const results: { filename: string; ok: boolean; org_id?: string; period_start?: string; period_end?: string; row_count?: number; error?: string }[] = [];

  for (const file of files) {
    const filename = file.name;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("5MB를 초과합니다.");
      const meta = parseMembersFilename(filename) ?? override;
      if (!meta) throw new Error("파일명에서 조직/기간을 읽을 수 없습니다. members-analytics-<조직ID>-<시작>-to-<끝>.csv 형식이거나 조직·기간을 직접 지정하세요.");
      if (meta.periodStart > meta.periodEnd) throw new Error("기간 시작이 끝보다 늦습니다.");
      const { rows, missing } = parseMembersCsv(await file.text());
      if (missing.length > 0) throw new Error(`필수 칼럼 누락: ${missing.join(", ")}`);
      if (rows.length === 0) throw new Error("데이터 행이 없습니다.");

      const orgUp = await admin.from("claude_orgs").upsert({ id: meta.orgId, name: meta.orgId.slice(0, 8) }, { onConflict: "id", ignoreDuplicates: true });
      if (orgUp.error) throw new Error(orgUp.error.message);

      const del = await admin.from("claude_csv_imports").delete().eq("org_id", meta.orgId).eq("period_start", meta.periodStart).eq("period_end", meta.periodEnd);
      if (del.error) throw new Error(del.error.message);

      const ins = await admin
        .from("claude_csv_imports")
        .insert({ org_id: meta.orgId, period_start: meta.periodStart, period_end: meta.periodEnd, filename, uploaded_by: auth.userId, row_count: rows.length })
        .select("id")
        .single();
      if (ins.error) throw new Error(ins.error.message);

      const byEmail = new Map(rows.map((r) => [r.email, r])); // 같은 이메일 중복 시 마지막 행
      const payload = [...byEmail.values()].map((r) => ({ ...r, import_id: ins.data.id, org_id: meta.orgId, period_start: meta.periodStart, period_end: meta.periodEnd }));
      for (let i = 0; i < payload.length; i += 500) {
        const chunk = await admin.from("claude_member_activity").insert(payload.slice(i, i + 500));
        if (chunk.error) throw new Error(chunk.error.message);
      }
      results.push({ filename, ok: true, org_id: meta.orgId, period_start: meta.periodStart, period_end: meta.periodEnd, row_count: payload.length });
    } catch (e) {
      results.push({ filename, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ results });
}
