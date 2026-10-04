import { expect, it, vi } from "vitest";
import { generateBriefing } from "@/lib/mobile/briefing-llm";
import { sanitizePayload } from "@/lib/mobile/briefing";

const fake = (stop: string, text: string) => {
  const create = vi.fn().mockResolvedValue({ stop_reason: stop, content: [{ type: "text", text }] });
  return { create, client: { messages: { create } } as never };
};

it("생각을 끄고(between_tools) 보낸다 — 생각이 max_tokens를 먼저 써서 문장이 잘리던 문제", async () => {
  const f = fake("end_turn", " 오늘은 일정이 없습니다. ");
  const r = await generateBriefing(sanitizePayload({}), { client: f.client, model: "m" });
  expect(r).toEqual({ text: "오늘은 일정이 없습니다.", model: "m" });
  expect(f.create.mock.calls[0][0].thinking).toEqual({ type: "between_tools" });
});
it("max_tokens로 잘린 응답은 쓰지 않고 오류 — 앱은 기존 문장·격언을 유지한다", async () => {
  const f = fake("max_tokens", "강승");
  await expect(generateBriefing(sanitizePayload({}), { client: f.client, model: "m" })).rejects.toThrow(/잘림|max_tokens/);
});
it("빈 문장도 오류", async () => {
  const f = fake("end_turn", "   ");
  await expect(generateBriefing(sanitizePayload({}), { client: f.client, model: "m" })).rejects.toThrow();
});
