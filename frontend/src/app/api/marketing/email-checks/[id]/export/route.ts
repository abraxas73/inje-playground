import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { mkdtemp, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { dbCheck, failure, marketingAuth, MarketingError } from "@/lib/marketing/server";
import { CHECK_LABELS, type EmailReport } from "@/lib/marketing/email/types";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let directory: string | undefined; let book: ExcelJS.stream.xlsx.WorkbookWriter | undefined;
  try {
    const { db } = await marketingAuth(); const { id } = await params; const q = req.nextUrl.searchParams;
    async function page(n: number) { const r = await db.rpc("marketing_email_report", { p_id: id, p_page: n, p_limit: 500, p_state: q.get("state") ?? "", p_q: (q.get("q") ?? "").slice(0, 100) }); dbCheck(r.error); if (!r.data) throw new MarketingError("검사 실행을 찾을 수 없습니다.", 404); return r.data as EmailReport; }
    const first = await page(1); directory = await mkdtemp(join(tmpdir(), "marketing-email-")); const file = join(directory, "results.xlsx");
    book = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false });
    const sheet = book.addWorksheet("이메일 검사", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = ["DB ID", "회사", "성명", "이메일", "종합", "주소 형식", "회사 연관성", "메일 수신 도메인", "MX", "홈페이지", "홈페이지 근거", "최종 URL", "페이지 제목", "회사명 문자열", "메일함 존재", "검사 시각", "DNS 확인 시각", "홈페이지 확인 시각", "현재 기준", "기준 버전"].map((header, i) => ({ header, width: [5, 6, 7, 10, 14].includes(i) ? 48 : 24 })); sheet.getRow(1).font = { bold: true }; sheet.getRow(1).commit(); let count = 0;
    for (let n = 1; n <= Math.max(1, Math.ceil(first.total / 500)); n++) {
      const report = n === 1 ? first : await page(n); if (report.token !== first.token || report.total !== first.total) throw new MarketingError("다운로드 중 검사 또는 기준이 바뀌었습니다. 다시 다운로드하세요.", 409);
      for (const t of report.rows) { const r = t.result; sheet.addRow([t.snapshot.db_id, t.snapshot.company, t.snapshot.name, t.snapshot.email, r ? CHECK_LABELS[r.state] : "미처리", r?.syntax?.message ?? "", r?.relationship?.message ?? "", r?.mail?.message ?? "", r?.mail?.mx?.map(m => m.exchange || ".").join(", ") ?? "", r?.website?.url ?? "", r?.website?.message ?? "", r?.website?.finalUrl ?? "", r?.website?.title ?? "", r?.companyMentioned ? "발견 (보조 근거)" : "미확인", r?.mailbox?.message ?? "미확인", r?.checkedAt ?? "", r?.mail?.checkedAt ?? "", r?.website?.checkedAt ?? "", t.stale ? "기준 변경·30일 경과" : "검사 당시 기준", String(t.snapshot.profile?.version ?? 0)]).commit(); count++; }
    }
    if (count !== first.total) throw new MarketingError("결과 일부를 읽지 못했습니다.", 503);
    sheet.autoFilter = { from: "A1", to: `T${count + 1}` }; sheet.commit();
    const info = book.addWorksheet("실행 정보"); info.columns = [{ width: 25 }, { width: 100 }];
    for (const row of [["실행 ID", id], ["시작 시각", first.run.created_at], ["대상", String(first.run.total)], ["다운로드 Contact", String(count)], ["범위", first.run.scope], ["대상 필터", JSON.stringify(first.run.filters)], ["결과 필터", JSON.stringify(Object.fromEntries(q))], ["메일함 존재", "이 검사는 개별 메일함 존재나 수신 성공을 확인하지 않습니다. 검사 메일을 발송하지 않습니다."], ["검사 영향", "Master를 자동 수정하지 않습니다. 변경 정보 제출 후 검수·승인이 필요합니다."]]) info.addRow(row).commit();
    info.commit(); await book.commit(); book = undefined;
    const cleanup = directory; directory = undefined;
    const stream = Readable.from((async function* () { try { for await (const chunk of createReadStream(file)) yield chunk; } finally { await rm(cleanup, { recursive: true, force: true }); } })());
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="Master-DB-email-check.xlsx"', "Cache-Control": "private, no-store" } });
  } catch (e) { if (book) await book.commit().catch(() => {}); if (directory) await rm(directory, { recursive: true, force: true }); return failure(e); }
}
