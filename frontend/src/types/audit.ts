/** 어드민 Audit 로그(뷰 audit_log) 한 행 */
export interface AuditRow {
  id: string;
  /** login = 로그인 이력, action = 의미 있는 액션, api = proxy 자동 기록 */
  kind: "login" | "action" | "api";
  /** ISO 시각 */
  at: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  category: string;
  action: string;
  detail: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
}

/** GET /api/admin/audit */
export interface AuditResponse {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  /** 필터 선택지(현재 데이터에 있는 카테고리) */
  categories: string[];
}
