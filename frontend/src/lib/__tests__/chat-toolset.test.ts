import { describe, expect, it } from "vitest";
import { buildToolset, clientPromptLines, needsAction, tierOf } from "@/lib/chat/toolset";
import { summarizeToolResult } from "@/lib/chat/summary";
import { sseLine } from "@/lib/chat/events";

const all = () => true;
describe("도구 목록", () => {
  it("웹·앱 꺼짐 — 서버 도구만, 아마란스 없음", () => {
    const t = buildToolset({ client: "web", desktopOnline: false, allowed: all });
    expect(t.tools.map((x) => x.name)).toContain("teams_send");
    expect(t.tools.map((x) => x.name)).not.toContain("list_mail_inbox");
    expect(t.tools.map((x) => x.name)).not.toContain("mail_send");
    expect(t.location.teams_send).toBe("server");
  });
  it("웹·앱 켜짐 — 아마란스 읽기 도구만 중계로", () => {
    const t = buildToolset({ client: "web", desktopOnline: true, allowed: all });
    const names = t.tools.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["list_mail_inbox", "read_mail", "search_mail_index", "pending_approvals"]));
    expect(names).not.toEqual(expect.arrayContaining(["send_mail"]));
    expect(names).not.toContain("submit_approval");
    expect(t.location.read_mail).toBe("desktop-relay");
    expect(new Set(names).size).toBe(names.length);
  });
  it("앱 — 아마란스는 기기 도구, 서버 도구는 서버", () => {
    const t = buildToolset({ client: "app", desktopOnline: false, allowed: all });
    expect(t.location.mail_send).toBe("device");
    expect(t.location.offer_choices).toBe("device");
    expect(t.location.confluence_search).toBe("server");
  });
  it("페이지 권한이 없으면 그 서버 도구와 아마란스 중계를 뺀다", () => {
    const t = buildToolset({ client: "web", desktopOnline: true, allowed: (k) => k !== "teams_chat" && k !== "mcp" });
    const names = t.tools.map((x) => x.name);
    expect(names).not.toContain("teams_send");
    expect(names).not.toContain("read_mail");
    expect(names).toContain("confluence_search");
  });
  it("확인이 필요한 호출 — 기기 도구 전부, 서버 쓰기, 모르는 도구는 아님", () => {
    expect(needsAction({ location: "device", tier: "read" })).toBe(true);
    expect(needsAction({ location: "server", tier: tierOf("teams_send") })).toBe(true);
    expect(needsAction({ location: "server", tier: tierOf("teams_chats") })).toBe(false);
    expect(needsAction({ location: "desktop-relay", tier: tierOf("read_mail") })).toBe(false);
    expect(needsAction({ location: null, tier: "write" })).toBe(false);
  });
  it("웹 문구 — 앱이 꺼져 있으면 안내 줄", () => {
    expect(clientPromptLines("web", false).join("\n")).toContain("데스크톱 앱");
    expect(clientPromptLines("app", false)).toEqual([]);
  });
});
describe("요약·SSE", () => {
  it("목록은 건수와 제목 5개까지", () => {
    const s = summarizeToolResult("list_mail_inbox", true, { items: [{ subject: "a" }, { subject: "b" }, { subject: "c" }, { subject: "d" }, { subject: "e" }, { subject: "f" }] });
    expect(s).toBe("받은메일 목록 6건: a, b, c, d, e");
  });
  it("단건은 제목, 실패는 사유", () => {
    expect(summarizeToolResult("read_mail", true, { subject: "주간보고" })).toBe("메일 읽기: 주간보고");
    expect(summarizeToolResult("teams_send", false, "권한이 없습니다")).toBe("Teams 보내기 실패: 권한이 없습니다");
    expect(summarizeToolResult("whatever", true, { ok: 1 })).toBe("whatever 완료");
  });
  it("SSE 한 줄", () => {
    expect(sseLine({ type: "text", delta: "안녕" })).toBe('data: {"type":"text","delta":"안녕"}\n\n');
  });
});
