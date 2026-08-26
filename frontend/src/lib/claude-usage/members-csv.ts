/** claude.ai 분석 > 멤버 "모두 보기" > CSV 내보내기(members-analytics-*.csv) 파서. 순수 함수. */
import type { MemberActivityRow } from "@/types/claude-usage";

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowStarted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c !== "\n" && c !== "\r") rowStarted = true;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (rowStarted) rows.push(row);
      row = [];
      rowStarted = false;
    } else field += c;
  }
  row.push(field);
  if (rowStarted || field !== "") rows.push(row);
  return rows;
}

type NumericField = Exclude<keyof MemberActivityRow, "name" | "email" | "role" | "seat_tier" | "last_active">;

/** CSV 헤더 → 필드. 키는 normalize(header) 결과. */
export const MEMBERS_CSV_COLUMNS: Record<string, keyof MemberActivityRow> = {
  name: "name",
  email: "email",
  role: "role",
  "seat tier": "seat_tier",
  "last active": "last_active",
  "days active": "days_active",
  chats: "chats",
  messages: "messages",
  "projects created": "projects_created",
  "projects used": "projects_used",
  "pull requests": "pull_requests",
  "code sessions": "code_sessions",
  "file edits": "file_edits",
  "cowork sessions": "cowork_sessions",
  "cowork messages": "cowork_messages",
  "artifacts created": "artifacts_created",
  "claude code artifacts": "claude_code_artifacts",
  "cowork artifacts": "cowork_artifacts",
  "estimated spend (usd)": "estimated_spend_usd",
};

const REQUIRED_HEADERS = ["Email", "Seat Tier", "Chats", "Code sessions", "Cowork Sessions"];

const NUMERIC_FIELDS: NumericField[] = [
  "days_active", "chats", "messages", "projects_created", "projects_used", "pull_requests", "code_sessions",
  "file_edits", "cowork_sessions", "cowork_messages", "artifacts_created", "claude_code_artifacts", "cowork_artifacts",
  "estimated_spend_usd",
];

function normalize(h: string): string {
  return h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function parseMembersCsv(text: string): { rows: MemberActivityRow[]; missing: string[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], missing: [...REQUIRED_HEADERS] };
  const header = table[0].map(normalize);
  const index = new Map<keyof MemberActivityRow, number>();
  header.forEach((h, i) => {
    const field = MEMBERS_CSV_COLUMNS[h];
    if (field && !index.has(field)) index.set(field, i);
  });
  const missing = REQUIRED_HEADERS.filter((h) => !index.has(MEMBERS_CSV_COLUMNS[normalize(h)]));
  if (missing.length > 0) return { rows: [], missing };

  const cell = (r: string[], f: keyof MemberActivityRow): string | undefined => {
    const i = index.get(f);
    return i === undefined ? undefined : r[i]?.trim();
  };

  const rows: MemberActivityRow[] = [];
  for (const r of table.slice(1)) {
    const email = cell(r, "email")?.toLowerCase();
    if (!email) continue;
    const row: MemberActivityRow = {
      name: cell(r, "name") ?? "",
      email,
      role: cell(r, "role") ?? "",
      seat_tier: cell(r, "seat_tier") ?? "",
      last_active: cell(r, "last_active") || null,
      days_active: 0, chats: 0, messages: 0, projects_created: 0, projects_used: 0, pull_requests: 0, code_sessions: 0,
      file_edits: 0, cowork_sessions: 0, cowork_messages: 0, artifacts_created: 0, claude_code_artifacts: 0,
      cowork_artifacts: 0, estimated_spend_usd: 0,
    };
    for (const f of NUMERIC_FIELDS) row[f] = toNumber(cell(r, f));
    rows.push(row);
  }
  return { rows, missing: [] };
}

const FILENAME_RE = /members-analytics-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})/i;

export function parseMembersFilename(name: string): { orgId: string; periodStart: string; periodEnd: string } | null {
  const m = FILENAME_RE.exec(name);
  if (!m) return null;
  return { orgId: m[1].toLowerCase(), periodStart: m[2], periodEnd: m[3] };
}
