import { describe, it, expect } from "vitest";
import { SETTING_KEYS, DEFAULT_SETTINGS } from "@/hooks/useSettings";
import { PROVIDER_SETTING_KEYS, TEAMS_SETTING_KEYS } from "@/lib/providers";

describe("SETTING_KEYS", () => {
  it("기존 키를 모두 보존한다", () => {
    for (const k of ["dooray_token", "dooray_project_id", "kakao_rest_api_key", "dooray_messenger_url", "dooray_hook_url"]) {
      expect(SETTING_KEYS).toContain(k);
    }
  });

  it("provider 3축 + Teams 5키를 포함한다", () => {
    for (const k of Object.values(PROVIDER_SETTING_KEYS)) expect(SETTING_KEYS).toContain(k);
    for (const k of TEAMS_SETTING_KEYS) expect(SETTING_KEYS).toContain(k);
  });

  it("DEFAULT_SETTINGS는 모든 키를 빈 문자열로", () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([...SETTING_KEYS].sort());
    expect(Object.values(DEFAULT_SETTINGS).every((v) => v === "")).toBe(true);
  });
});
