// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploads: Array<{ path: string; body: Buffer }> = [];
const inserts: Array<Record<string, unknown>> = [];
const admin = {
  storage: { from: () => ({ upload: async (path: string, body: Buffer) => { uploads.push({ path, body }); return { error: null }; }, remove: async () => ({ error: null }) }) },
  from: () => ({ insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null }; } }),
};
const perms = vi.hoisted(() => ({ value: {} as Record<string, boolean> }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => ({ ok: true, userId: "u1", role: "user", admin }) }));
vi.mock("@/lib/chat/access", () => ({ loadPermissions: async () => perms.value }));
vi.mock("@/lib/sharepoint/pptx", () => ({ pptxExtractor: () => undefined }));
import { POST } from "@/app/api/chat/attachments/route";

const req = (name: string, content: string) => {
  const form = new FormData();
  form.set("file", new File([content], name));
  return new Request("http://x/api/chat/attachments", { method: "POST", body: form }) as never;
};

describe("POST /api/chat/attachments", () => {
  beforeEach(() => { uploads.length = 0; inserts.length = 0; perms.value = {}; });
  it("파일 이름의 개인정보도 가려 저장·반환한다", async () => {
    const j = await (await POST(req("홍길동 900101-1234567.txt", "본문"))).json();
    expect(j.name).toBe("홍길동 [주민번호].txt");
    expect(inserts[0].name).toBe("홍길동 [주민번호].txt");
    expect(j.maskedCount).toBe(1);
    expect(inserts[0].masked_count).toBe(1);
  });
  it("텍스트 문서는 가린 text.txt만 저장하고 원본은 올리지 않는다", async () => {
    const res = await POST(req("메모.txt", "번호 010-1234-5678"));
    const j = await res.json();
    expect(uploads.map((u) => u.path.split("/").pop())).toEqual(["text.txt"]);
    const text = uploads[0].body.toString("utf8");
    expect(text).toContain("[전화번호]");
    expect(text).not.toContain("010-1234-5678");
    expect(j.maskedCount).toBe(1);
  });
  it("이미지는 원본만 저장하고 경고를 준다", async () => {
    const j = await (await POST(req("사진.png", "png"))).json();
    expect(uploads.map((u) => u.path.split("/").pop())).toEqual(["original.png"]);
    expect(j.warning).toBeTruthy();
  });
  it("권한이 없으면 403, 업로드 없음", async () => {
    perms.value = { assistant: false };
    expect((await POST(req("a.txt", "x"))).status).toBe(403);
    expect(uploads).toHaveLength(0);
  });
});
