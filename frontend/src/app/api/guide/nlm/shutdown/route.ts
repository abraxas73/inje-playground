import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

const FLY_API_TOKEN = process.env.FLY_API_TOKEN;
const FLY_APP_NAME = process.env.FLY_APP_NAME || "inje-nlm-service";
const FLY_MACHINES_API = "https://api.machines.dev/v1";

/** POST /api/guide/nlm/shutdown — NLM 서비스 머신 중지 (admin only) */
export async function POST() {
  try {
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

    // Check admin role
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

    if (!FLY_API_TOKEN) {
      return NextResponse.json(
        { error: "FLY_API_TOKEN이 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    // List machines
    const listRes = await fetch(
      `${FLY_MACHINES_API}/apps/${FLY_APP_NAME}/machines`,
      {
        headers: { Authorization: `Bearer ${FLY_API_TOKEN}` },
      }
    );
    if (!listRes.ok) {
      throw new Error(`머신 목록 조회 실패: ${listRes.status}`);
    }

    const machines = await listRes.json();
    const stoppedMachines: string[] = [];

    for (const machine of machines) {
      if (machine.state === "started") {
        const stopRes = await fetch(
          `${FLY_MACHINES_API}/apps/${FLY_APP_NAME}/machines/${machine.id}/stop`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${FLY_API_TOKEN}` },
          }
        );
        if (stopRes.ok) {
          stoppedMachines.push(machine.id);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message:
        stoppedMachines.length > 0
          ? `${stoppedMachines.length}개 머신 중지 완료`
          : "실행 중인 머신이 없습니다.",
      stoppedMachines,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "머신 중지에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
