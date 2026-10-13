import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAGES, PAGE_GROUPS, pagesForPath, canOpenPage } from "@/lib/page-access";
import { callApp, parseDetail, parseInbox, parseSearch } from "@/lib/gw/mail";
import MailPage from "@/app/gw/mail/page";

const relay = vi.hoisted(() => ({ relayToolCall: vi.fn() }));
vi.mock("@/lib/mcp/relay", () => relay);
afterEach(() => { vi.unstubAllGlobals(); relay.relayToolCall.mockReset(); });

describe("메뉴 카탈로그 — 앱 하단 바와 같은 상위·하위 구조", () => {
  it("상위 메뉴 3개(일상·AI·업무)와 메일 키(메뉴 숨김)·API 매핑", () => {
    expect(PAGE_GROUPS.map((g) => [g.id, g.label])).toEqual([["daily", "일상"], ["ai", "AI"], ["work", "업무"]]); // 앱 전용 '아마란스' 그룹은 웹 메뉴에 없다
    expect(PAGES.find((p) => p.key === "gw_mail")).toMatchObject({ href: "/gw/mail", group: "work", minRole: "user", hidden: true });
    expect(pagesForPath("/gw/mail")).toEqual(["gw_mail"]);
    expect(pagesForPath("/api/gw/mail/123/unread")).toEqual(["gw_mail"]);
    expect(canOpenPage("user", "/gw/mail", { gw_mail: false })).toBe(false);
    expect(canOpenPage("guest", "/gw/mail")).toBe(false);
  });
  it("DB 권한 함수의 키 목록(docs/sql/2026-10-11-dooray-connections.sql)이 웹 카탈로그와 같다", () => {
    const sql = readFileSync(resolve(process.cwd(), "..", "docs", "sql", "2026-10-11-dooray-connections.sql"), "utf8");
    const lists = [...sql.matchAll(/\(('[a-z_]+'(?:,'[a-z_]+')+)\)/g)].map((m) => m[1].replace(/'/g, "").split(",")).filter((l) => l.length > 10);
    expect(lists.length).toBeGreaterThanOrEqual(2); // valid_page_permissions · has_page_access
    expect(lists[0]).toContain("marketing"); // has_page_access는 marketing을 별도 분기로 다뤄 목록에 없다
    for (const keys of lists) for (const p of PAGES.filter((x) => x.key !== "marketing")) expect(keys, `${p.key}이(가) SQL 키 목록에 없음`).toContain(p.key);
  });
});

describe("메일 파서·중계", () => {
  it("받은메일 봉투의 Records를 앱과 같은 키로 읽고 잘못된 muid는 버린다", () => {
    const r = parseInbox({ TotalUnseenCount: "3", Records: [
      { muid: "101", subject: "회의", fromAddrName: "김", fromAddrEmail: "k@x.com", rfc822date: "2026-10-11 09:00:00", seen: 0, attach: "Y" },
      { muid: "102", subject: "", fromAddrName: "", fromAddrEmail: "n@x.com", rfc822date: "", seen: 1, attach: false },
      { muid: "abc", subject: "x" }, null,
    ] });
    expect(r.unread).toBe(3);
    expect(r.items).toEqual([
      { muid: "101", subject: "회의", from: "김", fromEmail: "k@x.com", date: "2026-10-11 09:00:00", seen: false, attach: true },
      { muid: "102", subject: "", from: "", fromEmail: "n@x.com", date: "", seen: true, attach: false },
    ]);
    expect(parseInbox(null)).toEqual({ unread: 0, items: [] });
  });
  it("본문 결과를 화면용으로 정리한다", () => {
    expect(parseDetail({ muid: "101", subject: "s", from: "f", to: "t", cc: "", date: "d", body: "본문", remoteResourceCount: 2, attachments: [{ fileName: "a.pdf", fileSizeApprox: 2048 }, { fileName: "" }] }))
      .toEqual({ muid: "101", subject: "s", from: "f", to: "t", cc: "", date: "d", body: "본문", remoteResourceCount: 2, attachments: [{ fileName: "a.pdf", fileSizeApprox: 2048 }] });
  });
  it("색인 검색 결과를 목록 항목 모양으로 읽고 색인 상태를 붙인다", () => {
    const r = parseSearch({ total: 2, hits: [{ muid: "7", box: "SENT", subject: "결산", fromName: "나", fromEmail: "me@x.com", to: "홍 <h@x.com>", date: "2026-10-03 09:00:00", seen: 1, attach: false, snippet: "…3층 회의실…", score: 6 }, { muid: "x" }], index: { docs: "12", bodies: 9, syncing: true, lastSync: null } });
    expect(r.hits).toEqual([{ muid: "7", box: "SENT", subject: "결산", from: "나", fromEmail: "me@x.com", to: "홍 <h@x.com>", date: "2026-10-03 09:00:00", seen: true, attach: false, snippet: "…3층 회의실…" }]);
    expect(r.total).toBe(2);
    expect(r.index).toEqual({ docs: 12, bodies: 9, syncing: true, lastSync: "", error: "" });
    expect(parseSearch(null)).toEqual({ total: 0, hits: [], index: { docs: 0, bodies: 0, syncing: false, lastSync: "", error: "" } });
  });
  it("앱 미실행 안내는 no_app, 정상 결과는 JSON으로 푼다", async () => {
    const admin = {} as never;
    relay.relayToolCall.mockResolvedValueOnce({ content: [{ type: "text", text: "데스크탑(맥·윈도우) 앱이 실행 중이 아닙니다. …" }], isError: true });
    expect(await callApp(admin, "u", "list_mail_inbox", {})).toMatchObject({ ok: false, code: "no_app" });
    relay.relayToolCall.mockResolvedValueOnce({ content: [{ type: "text", text: "시간 초과" }], isError: true });
    expect(await callApp(admin, "u", "read_mail", { muid: "1" })).toMatchObject({ ok: false, code: "tool", message: "시간 초과" });
    relay.relayToolCall.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ Records: [] }) }] });
    expect(await callApp(admin, "u", "list_mail_inbox", {})).toEqual({ ok: true, data: { Records: [] } });
    expect(relay.relayToolCall).toHaveBeenLastCalledWith({ admin }, "u", "list_mail_inbox", {});
  });
});

describe("메일 페이지", () => {
  it("앱이 꺼져 있으면 설치·다시 확인 안내를 보여 준다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "no_app", error: "앱을 켜 주세요" }, { status: 409 })));
    render(<MailPage />);
    expect(await screen.findByText("데스크톱 앱이 실행 중이 아닙니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "데스크톱 앱 받기" })).toHaveAttribute("href", "/apps");
    expect(screen.getByText("앱을 켜 주세요")).toBeInTheDocument();
  });
  it("검색어를 넣으면 데스크톱 앱 색인에서 찾아 결과·발췌·색인 상태를 보여 주고, 결과를 누르면 본문을 연다", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === "/api/gw/mail") return Response.json({ unread: 0, items: [] });
      if (url.startsWith("/api/gw/mail/search?")) return Response.json({ total: 1, hits: [{ muid: "7", subject: "결산 회의", from: "홍", fromEmail: "h@x.com", date: "2026-10-03 09:00:00", seen: true, attach: false, box: "INBOX", to: "", snippet: "…3층 회의실에서 합니다…" }], index: { docs: 12, bodies: 9, syncing: false, lastSync: "", error: "" } });
      if (url === "/api/gw/mail/7") return Response.json({ muid: "7", subject: "결산 회의", from: "홍", to: "나", cc: "", date: "2026-10-03 09:00:00", body: "3층 회의실에서 합니다", attachments: [], remoteResourceCount: 0 });
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<MailPage />);
    await screen.findByText("받은 메일이 없습니다.");
    fireEvent.change(screen.getByRole("searchbox", { name: "메일 검색" }), { target: { value: "회의실" } });
    expect(await screen.findByText(/3층 회의실에서 합니다/)).toBeInTheDocument(); // 발췌
    expect(fetch).toHaveBeenCalledWith("/api/gw/mail/search?q=%ED%9A%8C%EC%9D%98%EC%8B%A4&sort=date", expect.anything());
    expect(screen.getByText(/색인 12통 · 본문 9통/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /결산 회의/ }));
    expect(await screen.findByRole("heading", { name: "결산 회의" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/gw/mail/7", expect.anything());
  });
  it("목록 → 본문 열기(읽음 반영) → 안 읽음으로 되돌리기", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/gw/mail") return Response.json({ unread: 1, items: [{ muid: "101", subject: "회의 안내", from: "김", fromEmail: "k@x.com", date: "2026-10-11 09:00:00", seen: false, attach: true }] });
      if (url === "/api/gw/mail/101/unread" && init?.method === "POST") return Response.json({ ok: true });
      if (url === "/api/gw/mail/101") return Response.json({ muid: "101", subject: "회의 안내", from: "김", to: "나", cc: "", date: "2026-10-11 09:00:00", body: "10시 회의실 A", attachments: [{ fileName: "agenda.pdf", fileSizeApprox: 4096 }], remoteResourceCount: 0 });
      return Response.json({ error: "unexpected" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<MailPage />);
    fireEvent.click(await screen.findByRole("button", { name: /회의 안내/ }));
    expect(await screen.findByText("10시 회의실 A")).toBeInTheDocument();
    expect(screen.getByText("agenda.pdf")).toBeInTheDocument();
    expect(screen.getByText("안 읽음 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "안 읽음으로 되돌리기" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/gw/mail/101/unread", expect.objectContaining({ method: "POST" })));
    await act(async () => {});
    expect(screen.getByText("안 읽음 1")).toBeInTheDocument();
    expect(screen.queryByText("10시 회의실 A")).toBeNull();
  });
});
