import type { SupabaseClient } from "@supabase/supabase-js";

export type RelayDeps = { admin: SupabaseClient; now?: () => number; sleep?: (ms: number) => Promise<void> };
export const CLAIM_TIMEOUT_MS = 10_000, DONE_TIMEOUT_MS = 110_000, POLL_MS = 500, RATE_LIMIT_PER_MIN = 60;
export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const MSG_RATE = "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
const MSG_NO_APP = "데스크탑(맥·윈도우) 앱이 실행 중이 아닙니다. https://innocrew.innogrid.com/apps 에서 INNOGRID 데스크탑 앱을 설치해 같은 계정으로 로그인하고, 더보기 > 아마란스에서 연결한 뒤 더보기 > Claude 커넥터의 '요청 받기'를 켜세요(모바일 앱만 켜 둔 경우에도 이 안내가 나옵니다).";
const MSG_TIMEOUT = "앱이 응답하지 않았습니다(시간 초과). 쓰기 작업이었다면 아마란스에서 반영 여부를 확인하세요.";

/**
 * tools/call 한 건을 `mcp_calls` 행으로 앱에 넘기고 결과를 기다린다(service role 전용 — 사용자 토큰은 RLS로 INSERT·DELETE 불가).
 * 끝나면(성공·오류·시간 초과) 행을 지운다 — 인자·결과를 남기지 않는다.
 */
export async function relayToolCall(deps: RelayDeps, userId: string, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  const { admin } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const calls = () => admin.from("mcp_calls");

  // ponytail: 행은 호출마다 지워지므로 "최근 1분 건수"는 진행 중·잔여 행만 센다(근사치). 정확히 하려면 별도 카운터 테이블.
  const since = new Date(now() - 60_000).toISOString();
  const { count } = await calls().select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
  if ((count ?? 0) >= RATE_LIMIT_PER_MIN) return fail(MSG_RATE);

  const { data: row, error } = await calls().insert({ user_id: userId, tool, args, status: "pending" }).select("id").single();
  if (error || !row) return fail("요청을 앱에 전달하지 못했습니다. 잠시 후 다시 시도하세요.");
  const remove = () => calls().delete().eq("id", row.id);

  const start = now();
  for (;;) {
    await sleep(POLL_MS);
    const { data } = await calls().select("status,result").eq("id", row.id).single();
    const elapsed = now() - start;
    const result = (data?.result ?? {}) as { text?: unknown; error?: unknown };
    if (data?.status === "done") {
      await remove();
      return { content: [{ type: "text", text: typeof result.text === "string" ? result.text : JSON.stringify(result.text ?? null) }] };
    }
    if (data?.status === "error") {
      await remove();
      return fail(typeof result.error === "string" ? result.error : "도구 실행에 실패했습니다.");
    }
    if (data?.status === "pending" && elapsed >= CLAIM_TIMEOUT_MS) {
      // 조건부 삭제: 읽은 뒤 앱이 막 클레임했다면(0행) "앱 없음"이라 하지 않고 끝까지 기다린다 — 쓰기 도구 중복 실행 방지.
      const { data: gone } = await calls().delete().eq("id", row.id).eq("status", "pending").select("id");
      if (gone?.length) return fail(MSG_NO_APP);
      continue;
    }
    if (elapsed >= DONE_TIMEOUT_MS) { await remove(); return fail(MSG_TIMEOUT); }
  }
}
