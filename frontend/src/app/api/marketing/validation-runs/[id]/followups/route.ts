import { NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, response } from "@/lib/marketing/server";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await marketingAuth(true); const { id } = await params; const b = await req.json();
    const result = await db.rpc("marketing_validation_followup", { p_request_key:b.requestKey,p_run:id,p_contact:b.contactId,p_status:b.status,p_reason:b.reason,p_current_version:b.version,p_org_version:b.organizationVersion,p_submission:b.submissionId??null }); dbCheck(result.error); return response({id:result.data});
  } catch (e) { return failure(e); }
}
