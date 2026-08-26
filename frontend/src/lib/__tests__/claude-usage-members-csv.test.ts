import { describe, it, expect } from "vitest";
import { parseCsv, parseMembersCsv, parseMembersFilename } from "@/lib/claude-usage/members-csv";

const HEADER =
  '"Name","Email","Role","Seat Tier","Last Active","Days Active","Chats","Messages","Projects Created","Projects Used","Pull Requests","Code sessions","File Edits","Cowork Sessions","Cowork Messages","Artifacts Created","Claude Code Artifacts","Cowork Artifacts","Estimated Spend (USD)"';
const ROW1 = '"홍, 길동","Dev1@Example.com","User","Premium","2026-08-24","1","6","21","0","0","0","32","0","0","0","0","0","0","0.00"';
const ROW2 = '"Kim ""K""","dev2@example.com","Owner","","","0","0","0","0","0","0","0","0","0","0","0","0","0","1,234.50"';

describe("parseCsv", () => {
  it("BOM·따옴표·이스케이프·CRLF를 처리한다", () => {
    const rows = parseCsv('﻿"a","b ""q"" c",d\r\n1,"x,y",\r\n\r\n');
    expect(rows).toEqual([["a", 'b "q" c', "d"], ["1", "x,y", ""]]);
  });

  it("필드 중간의 따옴표는 리터럴이고 필드/행 구분을 깨지 않는다", () => {
    expect(parseCsv('ab"cd,e\n')).toEqual([['ab"cd', "e"]]);
    expect(parseCsv('"q",x"y\n')).toEqual([["q", 'x"y']]);
  });

  it("문자가 없는 줄만 건너뛰고, 빈 필드로만 된 행은 유지한다", () => {
    expect(parseCsv(",,\na,b\n\n")).toEqual([["", "", ""], ["a", "b"]]);
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
  });
});

describe("parseMembersCsv", () => {
  it("헤더 기반으로 매핑하고 값을 정규화한다", () => {
    const r = parseMembersCsv(`﻿${HEADER}\r\n${ROW1}\r\n${ROW2}\r\n`);
    expect(r.missing).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      name: "홍, 길동", email: "dev1@example.com", role: "User", seat_tier: "Premium", last_active: "2026-08-24",
      days_active: 1, chats: 6, messages: 21, projects_created: 0, projects_used: 0, pull_requests: 0, code_sessions: 32,
      file_edits: 0, cowork_sessions: 0, cowork_messages: 0, artifacts_created: 0, claude_code_artifacts: 0, cowork_artifacts: 0,
      estimated_spend_usd: 0,
    });
    expect(r.rows[1]).toMatchObject({ name: 'Kim "K"', seat_tier: "", last_active: null, estimated_spend_usd: 1234.5 });
  });

  it("칼럼 순서가 달라도, 알 수 없는 칼럼이 있어도 동작하고 이메일 없는 행은 건너뛴다", () => {
    const text = `Email,Chats,Seat Tier,Cowork Sessions,Code sessions,Extra\ndev3@example.com,2,Standard,1,0,zzz\n,5,Premium,0,0,\n`;
    const r = parseMembersCsv(text);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ email: "dev3@example.com", chats: 2, seat_tier: "Standard", cowork_sessions: 1, code_sessions: 0, name: "" });
  });

  it("필수 칼럼이 없으면 거부한다", () => {
    const r = parseMembersCsv(`Name,Email,Chats\nA,dev@example.com,1\n`);
    expect(r.rows).toEqual([]);
    expect(r.missing).toEqual(["Seat Tier", "Code sessions", "Cowork Sessions"]);
  });
});

describe("parseMembersFilename", () => {
  it("조직 ID와 기간을 추출한다", () => {
    expect(parseMembersFilename("members-analytics-4ad6b3e9-552f-4b67-bb96-25b51d1852f4-2026-07-27-to-2026-08-25.csv")).toEqual({
      orgId: "4ad6b3e9-552f-4b67-bb96-25b51d1852f4", periodStart: "2026-07-27", periodEnd: "2026-08-25",
    });
    expect(parseMembersFilename("members-analytics-4AD6B3E9-552F-4B67-BB96-25B51D1852F4-2026-07-27-to-2026-08-25 (1).csv")?.orgId).toBe("4ad6b3e9-552f-4b67-bb96-25b51d1852f4");
    expect(parseMembersFilename("claude-code-productivity-raw.csv")).toBeNull();
  });
});
