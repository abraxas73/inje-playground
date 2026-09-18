/** Claude 비용 관리 — Stripe 인보이스 원장 + Admin API cost_report + 월별 집계 */

export interface ParsedInvoiceLine {
  position: number;
  description: string;
  quantity: number | null;
  /** 음수 = 프로레이션 크레딧("Unused time on …") */
  amountCents: number;
  taxRate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** 설명 "97 × Team plan - Premium …"에서 읽은 좌석 수·티어 */
  seats: number | null;
  plan: string | null;
}

export interface ParsedInvoice {
  invoiceNumber: string;
  issuedOn: string;
  billTo: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  periodStart: string | null;
  periodEnd: string | null;
  /** 양수 금액 라인의 좌석 합 / 티어(둘 이상이면 ", "로 이어 붙임) */
  seats: number | null;
  plan: string | null;
  lines: ParsedInvoiceLine[];
}

export type InvoiceParseResult = { ok: true; invoice: ParsedInvoice } | { ok: false; errors: string[] };

/** claude_invoice_lines 한 행 */
export interface InvoiceLineRow {
  invoice_id: string;
  position: number;
  description: string;
  quantity: number | null;
  amount_cents: number;
  tax_rate: string | null;
  period_start: string | null;
  period_end: string | null;
  seats: number | null;
  plan: string | null;
}

/** claude_invoices 한 행(API 응답 — raw_text·storage_path는 내려주지 않는다) */
export interface InvoiceRow {
  id: string;
  invoice_number: string;
  org_id: string | null;
  bill_to: string;
  issued_on: string;
  period_start: string | null;
  period_end: string | null;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  seats: number | null;
  plan: string | null;
  source: "link" | "pdf";
  source_url: string | null;
  created_at: string;
  lines?: InvoiceLineRow[];
}

/** claude_api_cost_daily 한 행 — amount_cents는 소수 센트 문자열 그대로 */
export interface ApiCostRow {
  day: string;
  workspace_id: string;
  description: string;
  cost_type: string | null;
  model: string | null;
  amount_cents: string;
  currency: string;
}

export interface MonthlyOrgCost {
  /** null = Bill to가 어느 조직과도 맞지 않아 미배정 */
  orgId: string | null;
  name: string;
  invoices: InvoiceRow[];
  totalCents: number;
  seats: number | null;
  plan: string | null;
  /** OTel Claude Code 활성 사용자(그 달, 그 조직) */
  activeUsers: number;
  estCostUsd: number;
}

export interface MonthlyCost {
  /** YYYY-MM */
  month: string;
  invoices: number;
  billed: { subtotalCents: number; taxCents: number; totalCents: number };
  seats: number | null;
  /** 이 달 인보이스가 없는 Team 조직 이름 */
  missingOrgs: string[];
  unassignedCents: number;
  /** Admin API 비용(센트, 소수 가능). 키가 없으면 null */
  apiCostCents: number | null;
  usage: { activeUsers: number; sessions: number; promptsHuman: number; estCostUsd: number };
  /** 그 달에 끝나는 멤버 활동 CSV(조직별 최신)의 활동 멤버 합. 없으면 null */
  csvActiveMembers: number | null;
  perOrg: MonthlyOrgCost[];
}
