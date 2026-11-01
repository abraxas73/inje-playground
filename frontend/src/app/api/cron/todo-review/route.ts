import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildReviewStats, todoAiEnabled, todoModel, writeReview, type ReviewRow } from "@/lib/todo/ai";

export const runtime = "nodejs";
export const maxDuration = 300;
// 한 번에 다루는 사람 수 — 1인당 Claude 1회(수 초). 남은 사람은 다음 시간 실행이 이어서(이번 주 이미 만든 사람은 건너뜀)
const BATCH = 40;

/**
 * 주간 할 일 리뷰(JARVIS review-todo-weekly) — 매주 일요일 18:00 KST부터 매시간(vercel.json 일 09~14 UTC).
 * 지난 7일에 할 일이 만들어졌거나 바뀐 사람마다 통계 → Claude 회고 → todo_review_runs에 덮어쓴다. 6일 안에 만든 사람은 건너뛴다.
 * 할 일 제목은 '여러 번 미룬 것' 5개(60자)만 Claude에 보낸다. 앱은 /todo/review에서 본인 행을 읽는다(RLS).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || ""), expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!todoAiEnabled()) return NextResponse.json({ skipped: "ANTHROPIC_API_KEY 없음" });
  const admin = createAdminClient();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const recent = new Date(Date.now() - 6 * 86400_000).toISOString();
  // 지난 7일 활동한 사람 — 1000행 상한이 있어 사람 단위로 나눠 읽는다(updated_at은 생성·완료·변경 모두 갱신)
  const users = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("todos").select("user_id").gte("updated_at", since).order("user_id").range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) users.add((r as { user_id: string }).user_id);
    if ((data ?? []).length < 1000) break;
  }
  const { data: done } = await admin.from("todo_review_runs").select("user_id").gte("last_run_at", recent);
  for (const r of done ?? []) users.delete((r as { user_id: string }).user_id);
  const targets = [...users].slice(0, BATCH);
  let ok = 0, failed = 0;
  for (const userId of targets) {
    try {
      const { data, error } = await admin.from("todos").select("state, priority, context_tags, migration_count, title, completed_at").eq("user_id", userId).or(`updated_at.gte.${since},state.eq.in_progress`).limit(1000); // 오래 묵은 진행 중·자주 미룬 것도 open·migrated에 세도록
      if (error) throw new Error(error.message);
      const stats = buildReviewStats((data ?? []) as ReviewRow[], since);
      const summary = await writeReview(stats);
      const { error: e2 } = await admin.from("todo_review_runs").upsert({ user_id: userId, last_run_at: new Date().toISOString(), last_summary: summary, last_stats: stats, model: todoModel() });
      if (e2) throw new Error(e2.message);
      ok++;
    } catch (e) {
      failed++;
      console.error("[todo-review] 실패:", e instanceof Error ? e.message : "unknown");
    }
  }
  return NextResponse.json({ ok, failed, remaining: Math.max(0, users.size - targets.length) });
}
