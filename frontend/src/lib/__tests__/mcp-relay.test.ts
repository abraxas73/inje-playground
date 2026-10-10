// @vitest-environment node
import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { relayToolCall } from "@/lib/mcp/relay";

type Row = { status: string; result?: unknown };
/** 가짜 service-role 클라이언트: 시각(ms)별 행 상태를 정해 두고 체인 호출을 기록한다. */
function fake(timeline: Array<[number, Row]>, recent = 0, claimOnDelete?: Array<[number, Row]>) {
  let t = 0;
  const log = { inserts: [] as unknown[], deletes: 0, condDeletes: 0, polls: 0 };
  const resolve = (ops: Array<[string, ...unknown[]]>) => {
    const op = (n: string) => ops.find((o) => o[0] === n);
    if (op("insert")) { log.inserts.push(op("insert")![1]); return { data: { id: "c1" }, error: null }; }
    if (op("delete")) {
      log.deletes++;
      if (!ops.some((o) => o[0] === "eq" && o[1] === "status")) return { error: null };
      log.condDeletes++;
      // 조건부 삭제 순간 앱이 클레임: 0행 삭제, 이후 상태는 claimOnDelete를 따른다.
      if (claimOnDelete) { timeline.push(...claimOnDelete.map(([d, r]): [number, Row] => [t + d, r])); return { data: [], error: null }; }
      return { data: [{ id: "c1" }], error: null };
    }
    if ((op("select")?.[2] as { head?: boolean } | undefined)?.head) return { count: recent, error: null };
    log.polls++;
    const row = timeline.filter(([at]) => at <= t).at(-1)?.[1] ?? null;
    return { data: row, error: null };
  };
  const chain = () => {
    const ops: Array<[string, ...unknown[]]> = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "insert", "delete", "eq", "gte", "single"]) q[m] = (...a: unknown[]) => { ops.push([m, ...a]); return q; };
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolve(ops)).then(ok, ko);
    return q;
  };
  const deps = { admin: { from: chain } as unknown as SupabaseClient, now: () => t, sleep: async (ms: number) => { t += ms; } };
  return { deps, log, time: () => t };
}

it("returns the app's text when the call goes pending → running → done", async () => {
  const f = fake([[0, { status: "pending" }], [1000, { status: "running" }], [3000, { status: "done", result: { text: '{"ok":true}' } }]]);
  const r = await relayToolCall(f.deps, "u1", "approval_counts", { a: 1 });
  expect(r).toEqual({ content: [{ type: "text", text: '{"ok":true}' }] });
  expect(f.log.inserts[0]).toMatchObject({ user_id: "u1", tool: "approval_counts", args: { a: 1 }, status: "pending" });
  expect(f.log.deletes).toBe(1);
});

it("tells the user to start the desktop app when nobody claims within 10s", async () => {
  const f = fake([[0, { status: "pending" }]]);
  const r = await relayToolCall(f.deps, "u1", "x", {});
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain("실행 중이 아닙니다");
  expect(r.content[0].text).toContain("https://innocrew.innogrid.com/apps");
  expect(r.content[0].text).toContain("요청 받기");
  expect(f.time()).toBe(10_000);
  expect(f.log.deletes).toBe(1);
});

it("keeps waiting when the app claims the row at the moment of the 10s conditional delete", async () => {
  const f = fake([[0, { status: "pending" }]], 0, [[0, { status: "running" }], [2000, { status: "done", result: { text: "결재 완료" } }]]);
  const r = await relayToolCall(f.deps, "u1", "x", {});
  expect(r).toEqual({ content: [{ type: "text", text: "결재 완료" }] });
  expect(f.log.condDeletes).toBe(1);
  expect(f.log.deletes - f.log.condDeletes).toBe(1);
});

it("passes the app's error through as isError", async () => {
  const f = fake([[0, { status: "running" }], [500, { status: "error", result: { error: "아마란스가 연결되어 있지 않습니다." } }]]);
  const r = await relayToolCall(f.deps, "u1", "x", {});
  expect(r).toEqual({ content: [{ type: "text", text: "아마란스가 연결되어 있지 않습니다." }], isError: true });
  expect(f.log.deletes).toBe(1);
});

it("times out after 110s of running", async () => {
  const f = fake([[0, { status: "running" }]]);
  const r = await relayToolCall(f.deps, "u1", "x", {});
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toBe("앱이 응답하지 않았습니다(시간 초과). 쓰기 작업이었다면 아마란스에서 반영 여부를 확인하세요.");
  expect(f.time()).toBe(110_000);
  expect(f.log.deletes).toBe(1);
});

it("refuses at 60 calls in the last minute without inserting", async () => {
  const f = fake([], 60);
  const r = await relayToolCall(f.deps, "u1", "x", {});
  expect(r).toEqual({ content: [{ type: "text", text: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }], isError: true });
  expect(f.log.inserts).toHaveLength(0);
  expect(f.log.polls).toBe(0);
});
