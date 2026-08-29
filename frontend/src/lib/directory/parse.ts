import type { AmaranthPerson, DirectoryUpsertRow } from "@/types/directory";

/**
 * 아마란스 deptPath "(주)이노그리드>(주)이노그리드>기술·운영부문>R&D본부>클라우드 네이티브 센터>XPU플랫폼팀"
 * → 회사 세그먼트(첫 세그먼트와 같은 이름의 연속 구간)를 떼고 ["기술·운영부문","R&D본부","클라우드 네이티브 센터","XPU플랫폼팀"].
 * 실데이터 깊이는 3~6(회사×2 + 1~4 단위). 부문만 있는 사람은 [부문] 하나.
 */
export function splitDeptPath(path: string | null | undefined): string[] {
  if (!path) return [];
  const segs = path.split(">").map((s) => s.trim()).filter(Boolean);
  if (segs.length === 0) return [];
  const company = segs[0];
  let i = 0;
  while (i < segs.length && segs[i] === company) i++;
  // 전부 회사명뿐이면(경로가 회사만) 빈 배열
  return segs.slice(i);
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** 원본 1명 → company_directory 행. 이메일이 없으면 null(식별 불가). */
export function normalizePerson(raw: AmaranthPerson): DirectoryUpsertRow | null {
  const email = str(raw.email)?.toLowerCase() ?? null;
  if (!email || !email.includes("@")) return null;
  const units = splitDeptPath(raw.deptPath);
  const deptName = str(raw.deptName);
  return {
    email,
    emp_seq: str(raw.empSeq),
    login_id: str(raw.loginId),
    name: str(raw.name) ?? email.split("@")[0],
    dept_id: str(raw.deptId),
    dept_name: deptName,
    dept_path: str(raw.deptPath),
    units,
    division: units[0] ?? null,
    headquarters: units[1] ?? null,
    team: deptName ?? (units.length ? units[units.length - 1] : null),
    duty: str(raw.duty),
    position: str(raw.position),
  };
}

/** 명부 배열 → 행 배열(이메일 기준 중복 제거, 첫 항목 유지). skipped = 이메일 없음/형식 아님. */
export function normalizeRoster(list: unknown): { rows: DirectoryUpsertRow[]; skipped: number } {
  if (!Array.isArray(list)) return { rows: [], skipped: 0 };
  const seen = new Set<string>();
  const rows: DirectoryUpsertRow[] = [];
  let skipped = 0;
  for (const item of list as AmaranthPerson[]) {
    const row = item && typeof item === "object" ? normalizePerson(item) : null;
    if (!row) {
      skipped++;
      continue;
    }
    if (seen.has(row.email)) continue;
    seen.add(row.email);
    rows.push(row);
  }
  return { rows, skipped };
}
