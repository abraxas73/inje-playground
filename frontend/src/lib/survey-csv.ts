import type { SurveyQuestion, SurveyResultSummary, QuestionAggregate, QuestionOption } from "@/types/survey";

export const CSV_BOM = "﻿";

export function escapeCsvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: (string | number | null)[][]): string {
  return CSV_BOM + rows.map((r) => r.map(escapeCsvField).join(",")).join("\r\n") + "\r\n";
}

export interface RawAnswerCell {
  value_text: string | null;
  value_number: number | null;
  value_json: unknown;
}
export interface RawExportResponse {
  id: string;
  submitted_at: string | null;
  is_complete: boolean;
  respondent_user_id?: string | null;
  respondent_hash?: string | null;
  answers: Record<string, RawAnswerCell>;
}
export interface RawExportInput {
  questions: SurveyQuestion[];
  responses: RawExportResponse[];
  includeIdentity: boolean;
}

interface ColumnSpec {
  header: string;
  get: (cell: RawAnswerCell | undefined) => string | number | null;
}

function readPrePost(c: RawAnswerCell | undefined, key: "before" | "after"): number | null {
  if (!c || c.value_json == null || typeof c.value_json !== "object") return null;
  const v = (c.value_json as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

function columnsForQuestion(q: SurveyQuestion): ColumnSpec[] {
  const opts: QuestionOption[] = q.config.options ?? [];
  switch (q.type) {
    case "single_choice":
      return [{
        header: q.title,
        get: (c) => {
          if (!c || c.value_text === null) return "";
          return opts.find((o) => o.value === c.value_text)?.label ?? c.value_text;
        },
      }];
    case "multi_choice": {
      // 옵션별 0/1 더미 컬럼(분석용)
      const dummyCols: ColumnSpec[] = opts.map((o) => ({
        header: `${q.title}::${o.label}`,
        get: (c) => {
          if (!c || c.value_json == null) return "";
          const arr = Array.isArray(c.value_json) ? (c.value_json as string[]) : [];
          return arr.includes(o.value) ? 1 : 0;
        },
      }));
      // 표시용: 선택 라벨을 ;로 결합한 컬럼 1개(미응답이면 빈 셀)
      const displayCol: ColumnSpec = {
        header: `${q.title}(선택)`,
        get: (c) => {
          if (!c || c.value_json == null) return "";
          const arr = Array.isArray(c.value_json) ? (c.value_json as string[]) : [];
          if (arr.length === 0) return "";
          return arr.map((v) => opts.find((o) => o.value === v)?.label ?? v).join(";");
        },
      };
      return [...dummyCols, displayCol];
    }
    case "pre_post_scale":
      return [
        { header: `${q.title}_before`, get: (c) => readPrePost(c, "before") },
        { header: `${q.title}_after`, get: (c) => readPrePost(c, "after") },
        {
          header: `${q.title}_delta`,
          get: (c) => {
            const b = readPrePost(c, "before");
            const a = readPrePost(c, "after");
            return b === null || a === null ? "" : a - b;
          },
        },
      ];
    case "scale":
    case "nps":
    case "number":
      return [{ header: q.title, get: (c) => (c && c.value_number !== null ? c.value_number : "") }];
    default: // text / textarea
      return [{ header: q.title, get: (c) => (c && c.value_text !== null ? c.value_text : "") }];
  }
}

export function buildRawCsv(input: RawExportInput): string {
  const ordered = [...input.questions].sort(
    (a, b) => (a.section ?? "").localeCompare(b.section ?? "") || a.order_index - b.order_index,
  );
  // 컬럼을 한 번만 계산하고 데이터 루프에서 재사용(문항별 재계산 제거)
  const cols = ordered.flatMap((q) =>
    columnsForQuestion(q).map((c) => ({ ...c, questionId: q.id })),
  );
  const idCols = input.includeIdentity ? ["respondent_user_id", "respondent_hash"] : [];
  const header = ["response_id", "submitted_at", "is_complete", ...idCols, ...cols.map((c) => c.header)];
  const rows: (string | number | null)[][] = [header];
  for (const r of input.responses) {
    const row: (string | number | null)[] = [
      r.id,
      r.submitted_at ?? "",
      r.is_complete ? "TRUE" : "FALSE",
    ];
    if (input.includeIdentity) {
      row.push(r.respondent_user_id ?? "", r.respondent_hash ?? "");
    }
    for (const col of cols) {
      row.push(col.get(r.answers[col.questionId]));
    }
    rows.push(row);
  }
  return toCsv(rows);
}

export function buildAggregateCsv(summary: SurveyResultSummary): string {
  const header = ["section", "order", "title", "type", "n", "mean", "median", "sd", "extra"];
  const rows: (string | number | null)[][] = [header];
  for (const q of summary.questions as QuestionAggregate[]) {
    rows.push(aggregateRow(q));
  }
  return toCsv(rows);
}

function aggregateRow(q: QuestionAggregate): (string | number | null)[] {
  const base = [q.section ?? "", q.order_index, q.title, q.type, q.n];
  if (q.masked) return [...base, "", "", "", "표본 부족(n<5)"];
  switch (q.type) {
    case "scale":
      return [...base, q.stats.mean, q.stats.median, q.stats.sd,
        `top-box ${q.stats.top_box_pct ?? "-"}%`];
    case "number":
      return [...base, q.stats.mean, q.stats.median, "",
        `sum ${q.stats.sum} ${q.stats.unit ?? ""} / trimmed ${q.stats.mean_trimmed} / zero_pct ${q.stats.zero_pct ?? "-"}%`];
    case "nps":
      return [...base, "", "", "",
        `NPS ${q.stats.score} (P${q.stats.promoters_pct}/D${q.stats.detractors_pct})`];
    case "pre_post_scale":
      return [...base, q.stats.after_mean, "", "",
        `Δ ${q.stats.delta_mean} (${q.stats.improvement_pct ?? "-"}%) pairwise ${q.stats.n_pairwise}`];
    case "single_choice":
    case "multi_choice":
      return [...base, "", "", "",
        q.options.map((o) => `${o.label}:${o.n}(${o.pct}%)`).join(" / ")];
    default: // text / textarea
      return [...base, "", "", "", `${q.text_n}건`];
  }
}

// scope=all 등 다중 섹션을 단일 BOM CSV로 병합(BOM 1회, 섹션 제목 행 + 빈 줄 구분)
export function combineCsvSections(sections: { title?: string; csv: string }[]): string {
  const stripBom = (s: string) => (s.startsWith(CSV_BOM) ? s.slice(CSV_BOM.length) : s);
  const blocks = sections
    .map((s) => ({ title: s.title, body: stripBom(s.csv).replace(/[\r\n]+$/, "") }))
    .filter((s) => s.body.trim().length > 0)
    .map((s) => (s.title ? `${escapeCsvField(`# ${s.title}`)}\r\n` : "") + s.body);
  return CSV_BOM + blocks.join("\r\n\r\n") + "\r\n";
}
