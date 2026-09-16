import { describe, expect, it, vi } from "vitest";
import { applyIdentityMap, isAccountless, loadIdentityMap } from "@/lib/claude-usage/identity-map";

const client = (result: { data?: unknown; error?: { message: string } }) =>
  ({ from: () => ({ select: async () => result }) }) as never;

describe("isAccountless", () => {
  it("id: 접두어와 unknown만 계정 미식별", () => {
    expect(isAccountless("id:abc")).toBe(true);
    expect(isAccountless("unknown")).toBe(true);
    expect(isAccountless("uuid:abc")).toBe(false);
    expect(isAccountless("a@innogrid.com")).toBe(false);
  });
});

describe("loadIdentityMap", () => {
  it("user_id에 id: 접두어를 붙이고 이메일을 소문자로 만든다", async () => {
    const m = await loadIdentityMap(client({ data: [{ user_id: "abc123", email: "Kang@Innogrid.com" }], error: undefined }));
    expect(m.get("id:abc123")).toBe("kang@innogrid.com");
  });
  it("테이블이 없으면 빈 맵으로 넘어간다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await loadIdentityMap(client({ error: { message: "relation does not exist" } }))).size).toBe(0);
    warn.mockRestore();
  });
});

describe("applyIdentityMap", () => {
  const rows = [{ user_email: "id:abc123", cost: 1 }, { user_email: "id:zzz", cost: 2 }, { user_email: "a@x.test", cost: 3 }];
  it("매핑된 식별자만 이메일로 바꾸고 나머지는 그대로 둔다", () => {
    const out = applyIdentityMap(rows, new Map([["id:abc123", "kang@innogrid.com"]]));
    expect(out.map((r) => r.user_email)).toEqual(["kang@innogrid.com", "id:zzz", "a@x.test"]);
    expect(out[0].cost).toBe(1);
    expect(rows[0].user_email).toBe("id:abc123");
  });
  it("매핑이 없으면 원본 배열을 그대로 돌려준다", () => {
    expect(applyIdentityMap(rows, new Map())).toBe(rows);
  });
});
