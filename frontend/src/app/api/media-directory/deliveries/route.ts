import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { noStore } from "@/lib/media-directory/server";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("media_alert_deliveries").select("id,sync_run_id,recipient_email,match_count,status,error_message,created_at").order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "발송 이력을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ deliveries: data ?? [] }, noStore);
}
