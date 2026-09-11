import type { NoticeCategory } from "@/types/people-news";

export const PAGE_SIZE = 20;

function dateBoundary(value: string, end: boolean): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("날짜 형식이 올바르지 않습니다.");
  const utc = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) {
    throw new Error("유효한 날짜를 입력해 주세요.");
  }
  // End date is inclusive in KST: use the next day's midnight as an exclusive bound.
  return new Date(utc.getTime() - 9 * 3_600_000 + (end ? 86_400_000 : 0)).toISOString();
}

export function parseNoticeQuery(params: URLSearchParams) {
  const category = params.get("category") || "all";
  if (!["all", "personnel", "obituary"].includes(category)) throw new Error("올바른 구분을 선택해 주세요.");
  const pageValue = params.get("page") ?? "1";
  const page = Number(pageValue);
  if (!/^\d+$/.test(pageValue) || !Number.isSafeInteger(page) || page < 1 || page > 10000) {
    throw new Error("페이지 번호가 올바르지 않습니다.");
  }
  const q = (params.get("q") ?? "").trim();
  if (q.length > 100) throw new Error("검색어는 100자까지 입력할 수 있습니다.");
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const fromIso = from ? dateBoundary(from, false) : null;
  const toIso = to ? dateBoundary(to, true) : null;
  if (from && to && from > to) throw new Error("시작일은 종료일보다 늦을 수 없습니다.");
  return {
    category: category as NoticeCategory | "all",
    page,
    offset: (page - 1) * PAGE_SIZE,
    // Escape LIKE wildcards. Filter values are never interpolated into .or() expressions.
    search: q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null,
    fromIso,
    toIso,
  };
}
