import { z } from "zod";
import { DoorayError, type DoorayRequest } from "./client";

export const messageSchema = z.object({
  kind: z.enum(["member", "channel"]),
  id: z.string().regex(/^\d{1,30}$/),
  text: z.string().trim().min(1).max(4000),
});
export async function searchMembers(request: DoorayRequest, query: string) {
  const q = query.trim();
  if (q.length < 2 || q.length > 100) throw new DoorayError("이름 또는 이메일을 2~100자로 입력해 주세요.", 400, "input");
  const raw = await request(`/common/v1/members?${new URLSearchParams({ [q.includes("@") ? "externalEmailAddresses" : "name"]: q, page: "0", size: "20" })}`);
  const parsed = z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string(), externalEmailAddress: z.string().nullish() })).safeParse(raw.result);
  if (!parsed.success) throw new DoorayError("멤버 검색 결과를 해석하지 못했습니다.");
  return parsed.data.map(m => ({ id: m.id, name: m.name, email: m.externalEmailAddress ?? "" }));
}
export async function sendMessage(request: DoorayRequest, input: z.infer<typeof messageSchema>) {
  const message = messageSchema.parse(input);
  if (message.kind === "member") {
    await request("/messenger/v1/channels/direct-send", { text: message.text, organizationMemberId: message.id });
  } else {
    await request(`/messenger/v1/channels/${message.id}/logs`, { text: message.text });
  }
}
