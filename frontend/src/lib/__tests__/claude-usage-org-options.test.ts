import { describe, expect, it } from "vitest";
import { displayUser, formatEnv, looksHeadlessLinux, orgBadgeLabel, orgCategory, orgSelectOptions } from "@/lib/claude-usage/org-options";
import type { ClaudeOrg } from "@/types/claude-usage";

const org = (id: string, name: string, over: Partial<ClaudeOrg> = {}): ClaudeOrg => ({ id, name, seats_total: null, sort_order: 0, ...over });
const orgs = [
  org("4ad6b3e9-552f-4b67-bb96-25b51d1852f4", "Innogrid-ax", { category: "team", sort_order: 1 }),
  org("3723fca1-9084-4ade-9a98-0674ce5cbd86", "Innogrid_S1", { category: "team" }),
  org("0615085a-1524-4b38-b49f-8169661d4ae2", "0615085a", { category: "personal" }),
  org("a5491601-e719-4acc-b5e6-c9d6f0ee86fc", "a5491601", { category: "personal" }),
  org("unknown", "unknown", { category: "system" }),
  org("test-org", "test-org", { category: "system" }),
];

describe("orgCategory", () => {
  it("category가 없으면 이름 규칙으로 보정한다", () => {
    expect(orgCategory(org("unknown", "unknown"))).toBe("system");
    expect(orgCategory(org("0615085a-1524-4b38-b49f-8169661d4ae2", "0615085a"))).toBe("personal");
    expect(orgCategory(org("4ad6b3e9-552f-4b67-bb96-25b51d1852f4", "Innogrid-ax"))).toBe("team");
    expect(orgCategory(org("x", "y", { category: "team" }))).toBe("team");
  });
});

describe("orgSelectOptions", () => {
  it("Team 조직은 개별, 개인 조직은 하나로 묶고 unknown·test-org는 항목으로 나열하지 않는다", () => {
    const opts = orgSelectOptions(orgs, { personal: true, unknown: true });
    expect(opts.map((o) => o.label)).toEqual(["전체 Claude 조직", "Innogrid_S1", "Innogrid-ax", "기타(개인 계정) 2개", "계정 정보 없는 세션"]);
    expect(opts.find((o) => o.label.startsWith("기타"))?.value).toBe("personal");
    expect(opts.at(-1)?.value).toBe("unknown");
  });
  it("CSV·Office 탭은 Team 조직만", () => {
    expect(orgSelectOptions(orgs).map((o) => o.value)).toEqual(["all", "3723fca1-9084-4ade-9a98-0674ce5cbd86", "4ad6b3e9-552f-4b67-bb96-25b51d1852f4"]);
  });
  it("개인 조직이 없으면 묶음 항목을 만들지 않는다", () => {
    expect(orgSelectOptions(orgs.slice(0, 2), { personal: true, unknown: true })).toHaveLength(3);
  });
});

describe("labels", () => {
  const map = new Map(orgs.map((o) => [o.id, o]));
  it("배지: unknown → 조직 미확인, 개인 조직 → 개인 계정 표시, Team → 이름, 모르는 id → 앞 8자", () => {
    expect(orgBadgeLabel("unknown", map)).toBe("조직 미확인");
    expect(orgBadgeLabel("0615085a-1524-4b38-b49f-8169661d4ae2", map)).toBe("개인 계정 0615085a");
    expect(orgBadgeLabel("4ad6b3e9-552f-4b67-bb96-25b51d1852f4", map)).toBe("Innogrid-ax");
    expect(orgBadgeLabel("deadbeef-0000", map)).toBe("deadbeef");
  });
  it("사용자: id:/unknown은 계정 정보 없는 세션, uuid:는 계정, 이메일은 그대로", () => {
    expect(displayUser("id:889e36ea1234567890")).toBe("계정 정보 없는 세션 889e36ea…");
    expect(displayUser("unknown")).toBe("계정 정보 없는 세션 (식별자 없음)");
    expect(displayUser("uuid:abcdef0123456789")).toBe("계정 abcdef01…");
    expect(displayUser("a@x.test")).toBe("a@x.test");
  });
  it("환경 표기와 컨테이너 추정", () => {
    expect(formatEnv({ os_type: "darwin", host_arch: "arm64", app_version: "2.1.32", terminal_type: "iTerm.app", points: 9 })).toBe("macOS/arm64 · iTerm.app · v2.1.32");
    expect(formatEnv({ os_type: "linux", host_arch: "x64", app_version: "", terminal_type: "", points: 1 })).toBe("Linux/x64");
    expect(formatEnv({ os_type: "", host_arch: "", app_version: "", terminal_type: "", points: 1 })).toBe("—");
    expect(formatEnv(undefined)).toBe("—");
    expect(looksHeadlessLinux({ os_type: "linux", host_arch: "x64", app_version: "2.1.0", terminal_type: "", points: 1 })).toBe(true);
    expect(looksHeadlessLinux({ os_type: "linux", host_arch: "x64", app_version: "2.1.0", terminal_type: "tmux", points: 1 })).toBe(false);
    expect(looksHeadlessLinux({ os_type: "darwin", host_arch: "arm64", app_version: "", terminal_type: "", points: 1 })).toBe(false);
  });
});
