export interface MediaDepartment { id: string; outlet_id: string; name: string; active: boolean; updated_at: string }
export interface MediaOutlet { id: string; name: string; aliases: string[]; any_department: boolean; active: boolean; updated_at: string; departments: MediaDepartment[] }
export interface MediaDirectoryResponse { outlets: MediaOutlet[]; totals: { outlets: number; activeOutlets: number; departments: number } }
export interface ImportRow { outlet: string; department: string | null }
export interface ImportPreview {
  filename: string;
  /** 중복 제거된 적재 대상 행 */
  rows: ImportRow[];
  total: number;
  blank: number;
  duplicates: number;
  invalid: { row: number; reason: string }[];
  newOutlets: string[];
  newDepartments: number;
  existingPairs: number;
  anyDepartmentOutlets: string[];
}
export interface ImportResult { outletsAdded: number; outletsExisting: number; departmentsAdded: number; departmentsExisting: number; anyDepartmentSet: number; skipped: number }
export interface MediaAlertSettings {
  email: string | null;
  emailVerified: boolean;
  enabled: boolean;
  updatedAt: string | null;
  latestDelivery: { status: "sent" | "failed"; created_at: string; match_count: number; error_message: string | null } | null;
}
export interface MediaDelivery { id: string; sync_run_id: number; recipient_email: string; match_count: number; status: "sent" | "failed"; error_message: string | null; created_at: string }
