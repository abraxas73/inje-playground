import { after, NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, MarketingError, response } from "@/lib/marketing/server";
import { runEmailWorker } from "@/lib/marketing/email/worker";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, reviewer } = await marketingAuth(); const { id } = await params; const q = req.nextUrl.searchParams;
    const r = await db.rpc("marketing_email_report", { p_id: id, p_page: Math.max(1, Math.min(100000, Number(q.get("page")) || 1)), p_state: q.get("state") ?? "", p_q: (q.get("q") ?? "").slice(0, 100) }); dbCheck(r.error);
    if (!r.data) throw new MarketingError("검사 실행을 찾을 수 없습니다.", 404);
    return response({ ...r.data, editable: reviewer });
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await marketingAuth(true); const { id } = await params; const b = await req.json();
    if (b.action === "recheck") {
      const created = await db.rpc("marketing_email_rerun", { p_id: id, p_key: b.requestKey }); dbCheck(created.error);
      after(async () => { try { await runEmailWorker(created.data); } catch { console.error("Marketing email worker interrupted; durable queue will resume."); } });
      return response({ id: created.data });
    }
    if (!["cancel", "retry", "resume"].includes(b.action)) throw new MarketingError("지원하지 않는 작업입니다.");
    // Resume uses the same permission/state check as retry without changing an active run.
    const r = await db.rpc("marketing_email_action", { p_id: id, p_action: b.action === "resume" ? "retry" : b.action }); dbCheck(r.error);
    if (b.action !== "cancel") after(async () => { try { await runEmailWorker(id); } catch { console.error("Marketing email worker interrupted; durable queue will resume."); } });
    return response({ ok: true });
  } catch (e) { return failure(e); }
}
