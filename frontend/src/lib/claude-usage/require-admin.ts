import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 세션 사용자가 admin인지 확인. 기존 /api/admin/* 라우트와 같은 401/403 메시지. */
export async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  const { data: caller } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  if (caller?.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }) };
  }
  return { ok: true, userId: user.id };
}

/** service role 클라이언트 또는 500 응답 */
export function adminClientOr500(): { ok: true; admin: SupabaseClient } | { ok: false; response: NextResponse } {
  try {
    return { ok: true, admin: createAdminClient() };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다." }, { status: 500 }) };
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isYmd(s: string | null | undefined): s is string {
  return !!s && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** PostgREST numeric → 문자열로 올 수 있어 숫자화(식별자 칼럼 제외) */
const ID_KEYS = new Set(["day", "org_id", "user_email", "account_uuid", "model", "id", "import_id", "email", "name", "role", "seat_tier", "last_active", "period_start", "period_end", "filename", "created_at"]);
export function numify<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = !ID_KEYS.has(k) && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return out as T;
}
