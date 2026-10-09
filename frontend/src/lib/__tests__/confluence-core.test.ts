import { describe, expect, it } from "vitest";
import { confluenceBase, cqlString, feedCql, hasConfluenceScopes, mapSearchResult, markdownToStorage, searchCql, CONFLUENCE_SCOPES } from "@/lib/confluence/core";

describe("confluence core", () => {
  it("Jira api_base에서 같은 사이트의 Confluence 주소를 만든다(다른 형식은 거부)", () => {
    expect(confluenceBase("https://api.atlassian.com/ex/jira/11111111-1111-1111-1111-111111111111")).toBe("https://api.atlassian.com/ex/confluence/11111111-1111-1111-1111-111111111111");
    expect(() => confluenceBase("https://evil.example/ex/jira/x")).toThrow();
  });
  it("받은 권한에 Confluence 읽기·검색이 모두 있어야 사용 가능", () => {
    expect(hasConfluenceScopes(null)).toBe(false);
    expect(hasConfluenceScopes(["read:jira-work"])).toBe(false);
    expect(hasConfluenceScopes([...CONFLUENCE_SCOPES])).toBe(true);
  });
  it("CQL 문자열은 따옴표·역슬래시를 이스케이프하고 길이를 자른다", () => {
    expect(cqlString('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(cqlString("x".repeat(300)).length).toBe(202);
  });
  it("검색·피드 CQL — 문서(page·blogpost)만, 최근 수정 순", () => {
    expect(searchCql("회의록")).toBe('type in (page, blogpost) and text ~ "회의록" order by lastmodified desc');
    expect(searchCql("회의록", "DEV")).toBe('type in (page, blogpost) and space = "DEV" and text ~ "회의록" order by lastmodified desc');
    expect(feedCql("mentions")).toBe("type in (page, blogpost, comment) and mention = currentUser() order by lastmodified desc");
    expect(feedCql("watching")).toBe('type in (page, blogpost) and watcher = currentUser() and lastmodified >= now("-14d") order by lastmodified desc');
    expect(feedCql("recent")).toBe("type in (page, blogpost) and contributor = currentUser() order by lastmodified desc");
  });
  it("검색 결과 → 앱 항목(링크는 회사 사이트 주소, 발췌는 강조 표시 제거)", () => {
    const r = { content: { id: "42", type: "page", title: "주간회의", space: { key: "DEV", name: "개발" }, version: { by: { displayName: "홍길동" }, when: "2026-10-01T01:00:00.000Z" }, _links: { webui: "/spaces/DEV/pages/42/x" } }, excerpt: "@@@hl@@@회의@@@endhl@@@ 내용", lastModified: "2026-10-01T01:00:00.000Z", url: "/spaces/DEV/pages/42/x" };
    expect(mapSearchResult(r)).toEqual({ id: "42", type: "page", title: "주간회의", spaceKey: "DEV", spaceName: "개발", url: "https://pms-innogrid.atlassian.net/wiki/spaces/DEV/pages/42/x", excerpt: "회의 내용", lastModified: "2026-10-01T01:00:00.000Z", by: "홍길동" });
    expect(mapSearchResult({ content: { id: "x" } })).toBeNull();
  });
  it("마크다운 → Confluence 저장 형식(제목·목록·번호·굵게·표·문단, HTML 이스케이프)", () => {
    const md = "# 회의록\n\n- 참석: <김>\n- **결정** 사항\n\n1. 첫째\n2. 둘째\n\n| 항목 | 담당 |\n|---|---|\n| 배포 | 이 |\n\n끝 문단";
    expect(markdownToStorage(md)).toBe("<h1>회의록</h1><ul><li>참석: &lt;김&gt;</li><li><strong>결정</strong> 사항</li></ul><ol><li>첫째</li><li>둘째</li></ol><table><tbody><tr><th>항목</th><th>담당</th></tr><tr><td>배포</td><td>이</td></tr></tbody></table><p>끝 문단</p>");
  });
  it("빈 글머리(-)도 목록 항목, 회의록 틀은 그대로 변환된다", async () => {
    expect(markdownToStorage("- \n-\n- 가")).toBe("<ul><li></li><li></li><li>가</li></ul>");
    const { meetingNotesMarkdown } = await import("@/lib/confluence/templates");
    const html = markdownToStorage(meetingNotesMarkdown({ date: "2026-10-10", name: "주간" }));
    expect(html).toContain("<h2>회의 개요</h2><ul><li>일시: 2026-10-10</li>");
    expect(html).toContain("<h2>액션 아이템</h2><table><tbody><tr><th>할 일</th><th>담당</th><th>기한</th></tr><tr><td></td><td></td><td></td></tr></tbody></table>");
    expect(html).not.toContain("<p>-</p>");
  });
});

describe("PPT 원고 — 회사 Confluence 주소 판별", () => {
  it("회사 사이트 주소만 Confluence 경로로", async () => {
    const { isCompanyConfluenceUrl } = await import("@/lib/confluence/ppt-source");
    expect(isCompanyConfluenceUrl("https://pms-innogrid.atlassian.net/wiki/spaces/D/pages/1/x")).toBe(true);
    expect(isCompanyConfluenceUrl("https://other.atlassian.net/wiki/spaces/D/pages/1")).toBe(false);
    expect(isCompanyConfluenceUrl("not a url")).toBe(false);
  });
});
