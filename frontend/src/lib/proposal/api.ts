/** 제안도우미-일반현황 API 공용 — 호출자·이름·잡 접근 판단. 페이지 권한(proposal)은 proxy가 /api/proposal에서 먼저 검사한다. */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser, type RfpCaller } from "@/lib/rfp/require-user";
import { JOB_COLUMNS, STALE_MS, type JobRow } from "./core";

export type Caller = RfpCaller & { name: string };

export async function caller(): Promise<({ ok: true } & Caller) | { ok: false; response: NextResponse }> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { data } = await auth.admin.from("user_profiles").select("display_name").eq("user_id", auth.userId).maybeSingle();
  return { ...auth, name: (data?.display_name as string | null) || auth.email || "사용자" };
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** 본인 것이거나 공유된 것만 보인다 */
export const canSee = (job: Pick<JobRow, "owner_id" | "share_enabled">, userId: string) => job.owner_id === userId || job.share_enabled;

/** 오래 멈춘 실행(서버리스 종료 등)은 실패로 보여 준다 */
export function settleStale(job: JobRow, now = Date.now()): JobRow {
  if ((job.status === "running" || job.status === "queued") && now - Date.parse(job.created_at) > STALE_MS) {
    return { ...job, status: "failed", error: job.error ?? "생성이 시간 안에 끝나지 않았습니다. 다시 만들어 주세요." };
  }
  return job;
}

export async function loadJob(admin: SupabaseClient, id: string): Promise<(JobRow & { template_path: string; result_path: string | null }) | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await admin.from("proposal_jobs").select(`${JOB_COLUMNS}, template_path, result_path`).eq("id", id).maybeSingle();
  return (data as (JobRow & { template_path: string; result_path: string | null }) | null) ?? null;
}
