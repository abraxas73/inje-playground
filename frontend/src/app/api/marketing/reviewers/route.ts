import { NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, response } from "@/lib/marketing/server";
export async function POST(req: NextRequest) {
  try {
    const { db } = await marketingAuth(false, true); const b = await req.json();
    if (typeof b.email !== "string" || typeof b.enabled !== "boolean") throw new Error("계정 이메일과 지정 여부를 확인해 주세요.");
    const user = await db.from("user_profiles").select("user_id").eq("email", b.email.trim().toLowerCase()).single(); dbCheck(user.error);
    const result = await db.rpc("marketing_set_reviewer", { p_user: user.data!.user_id, p_enabled: b.enabled }); dbCheck(result.error);
    return response({ ok: true });
  } catch (e) { return failure(e); }
}
