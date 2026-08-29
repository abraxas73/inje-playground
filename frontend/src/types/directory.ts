/** 사내 조직도 명부(그룹웨어 아마란스) — Claude 조직과 별개의 회사 소속 정보 */

/** inno-creed MCP `find_person` / `org_chart(dept_id)` 원본 항목 */
export interface AmaranthPerson {
  deptId?: string;
  deptName?: string;
  deptPath?: string;
  duty?: string;
  dutyCode?: string;
  email?: string;
  empSeq?: string;
  loginId?: string;
  name?: string;
  position?: string;
  note?: string;
  mobile?: string;
}

/** company_directory 한 행 */
export interface DirectoryPerson {
  email: string;
  emp_seq: string | null;
  login_id: string | null;
  name: string;
  dept_id: string | null;
  dept_name: string | null;
  dept_path: string | null;
  /** 회사 세그먼트를 뗀 경로 [부문, 본부, 센터, 팀] */
  units: string[];
  division: string | null;
  headquarters: string | null;
  team: string | null;
  duty: string | null;
  position: string | null;
  active: boolean;
  synced_at: string;
}

/** 동기화 페이로드에 들어가는 행(active/synced_at은 서버가 채움) */
export type DirectoryUpsertRow = Omit<DirectoryPerson, "active" | "synced_at">;

/** company_directory_sync 한 행 */
export interface DirectorySync {
  id: number;
  synced_at: string;
  source: string;
  query: string | null;
  total: number;
  upserted: number;
  deactivated: number;
  synced_by: string | null;
  note: string | null;
}

/** GET /api/admin/directory 응답 */
export interface DirectoryResponse {
  rows: DirectoryPerson[];
  lastSync: DirectorySync | null;
  counts: { active: number; inactive: number };
}
