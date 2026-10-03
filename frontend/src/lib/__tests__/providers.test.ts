import { describe, it, expect } from "vitest";
import {
  parseProvider,
  parseMemberSourceProvider,
  resolveProvider,
  PROVIDER_SETTING_KEYS,
  TEAMS_SETTING_KEYS,
  ADMIN_ONLY_SETTING_KEYS,
} from "@/lib/providers";

describe("parseProvider", () => {
  it("teams만 teams, 나머지는 모두 dooray 기본값", () => {
    expect(parseProvider("teams")).toBe("teams");
    expect(parseProvider(" Teams ")).toBe("teams");
    expect(parseProvider("dooray")).toBe("dooray");
    expect(parseProvider("")).toBe("dooray");
    expect(parseProvider(undefined)).toBe("dooray");
    expect(parseProvider(null)).toBe("dooray");
    expect(parseProvider("slack")).toBe("dooray");
  });
});

describe("parseMemberSourceProvider", () => {
  it("teams/users만 인식, 나머지는 dooray 기본값", () => {
    expect(parseMemberSourceProvider("users")).toBe("users");
    expect(parseMemberSourceProvider(" Users ")).toBe("users");
    expect(parseMemberSourceProvider("teams")).toBe("teams");
    expect(parseMemberSourceProvider("")).toBe("dooray");
    expect(parseMemberSourceProvider(undefined)).toBe("dooray");
    expect(parseMemberSourceProvider("slack")).toBe("dooray");
  });
});

describe("resolveProvider", () => {
  it("축별 settings 키를 읽는다", () => {
    const s = { notify_provider: "teams", dm_provider: "dooray" };
    expect(resolveProvider(s, "notify")).toBe("teams");
    expect(resolveProvider(s, "dm")).toBe("dooray");
    expect(resolveProvider(s, "memberSource")).toBe("dooray");
  });

  it("키 이름이 스펙 §4.1과 일치한다", () => {
    expect(PROVIDER_SETTING_KEYS).toEqual({
      notify: "notify_provider",
      memberSource: "member_source_provider",
      dm: "dm_provider",
    });
    expect([...TEAMS_SETTING_KEYS]).toEqual([
      "teams_notify_webhook_url",
      "teams_dm_webhook_url",
      "teams_members_webhook_url",
      "teams_graph_client_id",
      "teams_tenant_id",
      "teams_group_id",
    ]);
  });
});

describe("ADMIN_ONLY_SETTING_KEYS", () => {
  it("웹훅 URL은 숨기고 dooray_token은 숨기지 않는다(브라우저 확장에서 사용)", () => {
    expect(ADMIN_ONLY_SETTING_KEYS.has("dooray_hook_url")).toBe(true);
    expect(ADMIN_ONLY_SETTING_KEYS.has("teams_notify_webhook_url")).toBe(true);
    expect(ADMIN_ONLY_SETTING_KEYS.has("teams_dm_webhook_url")).toBe(true);
    expect(ADMIN_ONLY_SETTING_KEYS.has("teams_members_webhook_url")).toBe(true);
    expect(ADMIN_ONLY_SETTING_KEYS.has("dooray_token")).toBe(false);
    expect(ADMIN_ONLY_SETTING_KEYS.has("notify_provider")).toBe(false);
  });
});
