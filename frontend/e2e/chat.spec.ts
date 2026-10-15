/**
 * 이노봇 웹 채팅 — 1) 세션 없이 API 게이트(401). 2) 화면 흐름은 E2E_ADMIN_STORAGE_STATE가 있을 때만, /api/chat/*를 page.route로 가짜 응답(Claude·DB를 쓰지 않음).
 */
import { test, expect } from "@playwright/test";
import { ADMIN_STORAGE_STATE, hasAdminSession } from "./helpers/auth";

test.describe("이노봇 API 게이트", () => {
  test("세션 없이 턴·목록·첨부·상태 → 401", async ({ request }) => {
    expect((await request.post("/api/chat/turn", { data: { text: "a" } })).status()).toBe(401);
    expect((await request.get("/api/chat/conversations")).status()).toBe(401);
    expect((await request.post("/api/chat/attachments", { multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") } } })).status()).toBe(401);
    expect((await request.get("/api/chat/status")).status()).toBe(401);
  });
});

test.describe("이노봇 화면 (admin storageState 필요)", () => {
  test.skip(!hasAdminSession, "E2E_ADMIN_STORAGE_STATE 미설정");
  test.use({ storageState: hasAdminSession ? ADMIN_STORAGE_STATE : undefined });
  test("새 대화 → 답변 → 목록에 보임 → 삭제", async ({ page }) => {
    let list: Array<{ id: string; title: string; model: string; last_message_at: string }> = [];
    const id = "11111111-1111-1111-1111-111111111111";
    await page.route("**/api/chat/config", (r) => r.fulfill({ json: { enabled: true, models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" } }));
    await page.route("**/api/chat/status", (r) => r.fulfill({ json: { desktop: false, microsoft: true, atlassian: true } }));
    await page.route("**/api/chat/conversations?*", (r) => r.fulfill({ json: { conversations: list } }));
    await page.route("**/api/chat/conversations", (r) => r.fulfill({ json: { conversations: list } }));
    await page.route(`**/api/chat/conversations/${id}`, (r) => { if (r.request().method() === "DELETE") { list = []; return r.fulfill({ json: { ok: true } }); } return r.fulfill({ json: { conversation: { id, model: "claude-sonnet-5-5" }, messages: [], toolCalls: [] } }); });
    await page.route("**/api/chat/turn", (r) => {
      list = [{ id, title: "안녕", model: "claude-sonnet-5-5", last_message_at: new Date().toISOString() }];
      const ev = [{ type: "conversation", id }, { type: "text", delta: "안녕하세요, 이노봇입니다." }, { type: "done", messageId: "m1" }];
      return r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: ev.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") });
    });
    await page.goto("/chat");
    await expect(page.getByText("데스크톱 앱 꺼짐")).toBeVisible();
    await page.getByRole("textbox", { name: "메시지" }).fill("안녕");
    await page.keyboard.press("Enter");
    await expect(page.getByText("안녕하세요, 이노봇입니다.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/chat/${id}$`));
    const item = page.getByRole("navigation", { name: "대화 목록" }).getByRole("link", { name: "안녕" });
    await expect(item).toBeVisible();
    await item.hover();
    await page.getByRole("button", { name: "삭제" }).first().click();
    await page.getByRole("button", { name: "삭제 확인" }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByText("저장된 대화가 없습니다.")).toBeVisible();
  });
});
