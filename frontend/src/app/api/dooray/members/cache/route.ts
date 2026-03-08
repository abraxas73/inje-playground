import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

/** POST /api/dooray/members/cache — 브라우저에서 가져온 멤버를 DB에 캐시 */
export async function POST(request: NextRequest) {
  try {
    const { members } = await request.json();
    if (!Array.isArray(members) || members.length === 0) {
      return NextResponse.json({ saved: 0 });
    }

    const supabase = await createServerSupabase();
    const rows = members.map((m: { id: string; name: string }) => ({
      id: m.id,
      name: m.name,
      updated_at: new Date().toISOString(),
    }));

    await supabase
      .from("dooray_members")
      .upsert(rows, { onConflict: "id" });

    return NextResponse.json({ saved: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "캐시 저장 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
