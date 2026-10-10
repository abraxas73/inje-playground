import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
export const runtime = "nodejs";
export const maxDuration = 30;
/** 10분 지난 mcp_calls 행(비정상 종료 잔여물)을 지운다. 정상 흐름에서는 웹이 응답 뒤 바로 지운다. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || ""), expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await createAdminClient().from("mcp_calls").delete().lt("created_at", cutoff).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: data?.length ?? 0 });
}
