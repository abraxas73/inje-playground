import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export interface UserMember {
  id: string;
  name: string;
  dooray_member_id: string | null;
  /** Teams DM 수신자 식별(앱 사용자 명단/Teams 소스 또는 수동 입력) */
  email: string | null;
  /** 소스 측 식별자(앱 사용자 user_id, Teams 사용자 id 등) */
  external_id: string | null;
  is_card_holder: boolean;
  sort_order: number;
}

/** GET /api/users/members — 내 구성원 목록 */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_members")
    .select("id, name, dooray_member_id, email, external_id, is_card_holder, sort_order")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ members: data ?? [] });
}

/** POST /api/users/members — 내 팀 명단 저장 (기존 목록 교체, 법카 여부는 이름 기준 보존) */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const members: { name: string; dooray_member_id?: string; email?: string; external_id?: string }[] =
    body.members ?? [];

  // 삭제 전에 먼저 정제·검증 — 빈 명단으로 기존 목록을 지우지 않는다
  const cleaned = members
    .filter((m) => m && typeof m.name === "string" && m.name.trim())
    .map((m) => ({
      name: m.name.trim(),
      dooray_member_id: m.dooray_member_id ?? null,
      email: typeof m.email === "string" && m.email.trim() ? m.email.trim().toLowerCase() : null,
      external_id: typeof m.external_id === "string" && m.external_id.trim() ? m.external_id.trim() : null,
    }));
  if (!cleaned.length) {
    return NextResponse.json({ error: "구성원이 필요합니다." }, { status: 400 });
  }

  // Get existing members to preserve card holder status
  const { data: existing } = await supabase
    .from("user_members")
    .select("name, is_card_holder")
    .eq("user_id", user.id);

  const cardHolderMap = new Map<string, boolean>();
  for (const m of existing ?? []) {
    cardHolderMap.set(m.name, m.is_card_holder);
  }

  // Delete existing and re-insert (preserving card holder status)
  await supabase.from("user_members").delete().eq("user_id", user.id);

  const rows = cleaned.map((m, idx) => ({
    user_id: user.id,
    ...m,
    is_card_holder: cardHolderMap.get(m.name) ?? false,
    sort_order: idx,
  }));

  const { error } = await supabase.from("user_members").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}

/** PATCH /api/users/members — 법카 여부 토글 */
export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, is_card_holder } = body;

  if (!name || typeof is_card_holder !== "boolean") {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_members")
    .update({ is_card_holder, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("name", name);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/users/members?id=… (또는 ?name=…) — 구성원 삭제 (id 우선; 동명이인 안전) */
export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  const name = request.nextUrl.searchParams.get("name");
  if (!id && !name) {
    return NextResponse.json({ error: "id 또는 이름이 필요합니다." }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_members")
    .delete()
    .eq("user_id", user.id)
    .eq(id ? "id" : "name", (id ?? name) as string);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
