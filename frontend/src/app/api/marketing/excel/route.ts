import { NextRequest, NextResponse } from "next/server";
import { parseExcel, submissionTemplate } from "@/lib/marketing/excel";
import { dbCheck, failure, marketingAuth, response } from "@/lib/marketing/server";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET() {
  try {
    await marketingAuth(); const buffer = await submissionTemplate();
    return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=Contact-template.xlsx", "Cache-Control": "private, no-store" } });
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  try {
    const master = req.nextUrl.searchParams.get("mode") === "master";
    const { db } = await marketingAuth(false, master);
    const form = await req.formData(); const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) throw new Error("XLSX 파일을 선택해 주세요.");
    if (file.size > 10 * 1024 * 1024) throw new Error("파일은 10MB 이하여야 합니다.");
    const preview = await parseExcel(Buffer.from(await file.arrayBuffer()), file.name, master);
    if (form.get("confirm") === "true") {
      if (!master) throw new Error("신규 Contact는 미리보기 후 제출해 주세요.");
      if (form.get("hash") !== preview.hash) throw new Error("미리보기와 파일이 다릅니다. 다시 확인해 주세요.");
      if (preview.errors.length) throw new Error(preview.errors.join(" / "));
      const result = await db.rpc("marketing_import_master", { p_hash: preview.hash, p_filename: preview.filename, p_rows: preview.rows }); dbCheck(result.error);
      return response({ count: result.data });
    }
    return response({ ...preview, rows: master ? preview.rows.slice(0, 20) : preview.rows, issues: { missingCompany: preview.rows.filter(r => !r.data.company.trim()).length, missingName: preview.rows.filter(r => !r.data.name.trim()).length, unclassified: preview.rows.filter(r => r.category === "확인 필요").length } });
  } catch (e) { return failure(e); }
}
