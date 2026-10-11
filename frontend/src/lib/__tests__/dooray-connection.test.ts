// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decryptSecret } from "@/lib/ms/crypto";
import { connectionStatus, doorayConfig, loadConnection, saveConnection } from "@/lib/dooray/connection";
import { PAGES, pagesForPath, canOpenPage } from "@/lib/page-access";
import { readFileSync } from "node:fs";
const key = "ab".repeat(32);
beforeEach(() => { vi.stubEnv("DOORAY_TOKEN_ENC_KEY", key); vi.stubEnv("DOORAY_SITE", "https://example.dooray.com"); vi.stubEnv("DOORAY_ORGANIZATION_ID", "20"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("disables unconfigured or arbitrary-host connections", () => {
  expect(doorayConfig()?.organizationId).toBe("20");
  vi.stubEnv("DOORAY_SITE", "https://example.dooray.com.evil.invalid"); expect(doorayConfig()).toBeNull();
  vi.stubEnv("DOORAY_SITE", "https://example.dooray.com"); vi.stubEnv("DOORAY_TOKEN_ENC_KEY", ""); expect(doorayConfig()).toBeNull();
});
it("connects an independent Dooray account to the session user with an encrypted token", async () => {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const admin = { from: vi.fn(() => ({ upsert })), auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "me@innogrid.com" } } }) } } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ header: { isSuccessful: true }, result: { id: "1", name: "나", externalEmailAddress: "separate@injeinc.co.kr", defaultOrganization: { id: "20" } } })));
  await saveConnection(admin as never, "user-1", "private-token");
  const saved = upsert.mock.calls[0][0];
  expect(saved.user_id).toBe("user-1");
  expect(saved.account_email).toBe("separate@injeinc.co.kr");
  expect(JSON.stringify(saved)).not.toContain("private-token");
  expect(decryptSecret(saved.token_enc, Buffer.from(key, "hex"))).toBe("private-token");
});
it("status selects safe columns scoped to the current user", async () => {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { account_name: "나", account_email: "me@innogrid.com", connected_at: "now" } });
  const eq = vi.fn(() => ({ maybeSingle })); const select = vi.fn(() => ({ eq }));
  const result = await connectionStatus({ from: () => ({ select }) } as never, "user-1");
  expect(select).toHaveBeenCalledWith("member_id,account_name,account_email,connected_at");
  expect(eq).toHaveBeenCalledWith("user_id", "user-1");
  expect(result).toMatchObject({ connected: true, email: "me@innogrid.com" });
});
it("does not load credentials if company configuration is missing", async () => {
  vi.stubEnv("DOORAY_ORGANIZATION_ID", ""); const from = vi.fn();
  expect(await loadConnection({ from } as never, "u")).toBeNull(); expect(from).not.toHaveBeenCalled();
});
it("protects new pages/APIs without breaking legacy member consumers", () => {
  expect(PAGES.some(x => x.key === "dooray")).toBe(true);
  expect(pagesForPath("/api/dooray/overview")).toEqual(["dooray"]);
  expect(pagesForPath("/api/dooray/members/db")).toEqual([]);
  expect(canOpenPage("user", "/dooray", { dooray: false })).toBe(false);
  expect(canOpenPage("guest", "/dooray")).toBe(false);
});
it("migration restricts credentials to server and cascades account deletion", () => {
  const sql = readFileSync("../docs/sql/2026-10-11-dooray-connections.sql", "utf8");
  expect(sql).toContain("references auth.users(id) on delete cascade");
  expect(sql).toContain("enable row level security");
  expect(sql).toContain("from public, anon, authenticated");
});
