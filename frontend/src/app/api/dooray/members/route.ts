import { NextRequest, NextResponse } from "next/server";
import { fetchProjectMembers } from "@/lib/dooray";
import { createServerSupabase } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  const token = request.headers.get("x-dooray-token");

  if (!projectId || !token) {
    return NextResponse.json(
      { error: "projectId와 토큰이 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const members = await fetchProjectMembers(token, projectId);

    // Save members to DB
    const supabase = await createServerSupabase();
    const rows = members.map((m) => ({
      id: m.id,
      name: m.name,
      updated_at: new Date().toISOString(),
    }));
    if (rows.length > 0) {
      await supabase
        .from("dooray_members")
        .upsert(rows, { onConflict: "id" });
    }

    return NextResponse.json({ members });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "멤버 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
