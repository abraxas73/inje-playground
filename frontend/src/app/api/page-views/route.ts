import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { auditPagePath } from "@/lib/audit-page";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ skipped: true });
  const body = await request.json().catch(() => null);
  const path = auditPagePath(body?.path);
  if (!path) return NextResponse.json({ skipped: true });
  await logAudit(supabase, request, {
    userId: user.id, userEmail: user.email,
    action: `페이지 접근 ${path}`, category: "page", detail: { path },
  });
  return NextResponse.json({ ok: true });
}
