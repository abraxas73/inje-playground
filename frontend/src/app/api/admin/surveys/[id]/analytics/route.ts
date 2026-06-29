import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { SegmentFilter } from "@/types/survey";

/** GET /api/admin/surveys/[id]/analytics — 익명 집계(admin only) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const { data: caller } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (caller?.role !== "admin") {
      return NextResponse.json(
        { error: "관리자 권한이 필요합니다." },
        { status: 403 }
      );
    }

    let segments: SegmentFilter[] = [];
    const raw = request.nextUrl.searchParams.get("segments");
    if (raw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return NextResponse.json(
          { error: "segments 파라미터 형식이 올바르지 않습니다." },
          { status: 400 }
        );
      }
      if (!Array.isArray(parsed)) {
        return NextResponse.json(
          { error: "segments 파라미터 형식이 올바르지 않습니다." },
          { status: 400 }
        );
      }
      segments = parsed as SegmentFilter[];
    }

    const { data, error } = await supabase.rpc("get_survey_aggregate", {
      p_survey_id: id,
      p_segments: segments,
    });
    if (error) {
      if (error.message === "forbidden") {
        return NextResponse.json(
          { error: "접근이 거부되었습니다." },
          { status: 403 }
        );
      }
      console.error("[analytics] RPC error:", error);
      return NextResponse.json(
        { error: "집계 조회에 실패했습니다." },
        { status: 500 }
      );
    }

    if (data === null) {
      return NextResponse.json(
        { error: "설문을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[analytics] Unexpected error:", err);
    return NextResponse.json(
      { error: "집계 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
