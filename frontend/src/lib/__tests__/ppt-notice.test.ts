import { describe, expect, it } from "vitest";
import { buildTeamsNotice } from "@/lib/ppt/notice";

describe("buildTeamsNotice", () => {
  it("includes title, slides, version, owner, share link and SharePoint link", () => {
    const m = buildTeamsNotice({ title: "클라우드 전환", slides: 12, no: 2, owner: "a@innogrid.com", shareUrl: "https://app/ppt/s/abc", sharepointUrl: "https://sp/x.pptx" });
    expect(m.title).toBe("PPT 만들기");
    expect(m.text).toBe("[PPT] 클라우드 전환 (12장, v2) — a@innogrid.com\nhttps://app/ppt/s/abc\nSharePoint: https://sp/x.pptx");
  });
  it("says when the share link is off and omits SharePoint when absent", () => {
    const m = buildTeamsNotice({ title: "t", slides: null, no: 1, owner: "o", shareUrl: null, sharepointUrl: null });
    expect(m.text).toBe("[PPT] t (v1) — o\n공유 링크가 꺼져 있습니다");
  });
});
