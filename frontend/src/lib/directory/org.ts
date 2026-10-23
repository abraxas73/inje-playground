/** 조직도(/org) 데이터 — 부서 트리 + 재직자. 순수 함수(DB·네트워크 없음). */

export interface OrgDept {
  id: string;
  parentId: string | null;
  name: string;
  sort: number;
  depth: number;
}

export interface OrgPerson {
  email: string;
  empSeq: string | null;
  name: string;
  /** 소속 부서(OrgDept.id) */
  deptId: string | null;
  deptName: string | null;
  duty: string | null;
  position: string | null;
}

export interface OrgData {
  departments: OrgDept[];
  people: OrgPerson[];
  syncedAt: string | null;
  /** true면 부서 테이블이 비어 사람들의 부서 경로로 만든 트리(빈 부서·아마란스 순서 없음) */
  derived: boolean;
}

export interface DeptRow { id: string; parent_id: string | null; name: string; sort: number | null; depth: number | null }
export interface PersonRow { email: string; emp_seq: string | null; name: string; dept_id: string | null; dept_name: string | null; units: string[] | null; duty: string | null; position: string | null }

const ROOT = "__root__";

/**
 * 부서 행(아마란스 트리) + 사람 행 → 조직도.
 * 사람의 소속은 dept_id가 부서 id와 같으면 그대로, 아니면 부서 경로 이름(units, 회사 제외)으로 찾는다.
 * 부서 행이 없으면 사람들의 units로 트리를 만든다(id = 경로 이름 "부문>본부>팀", 루트 = 회사).
 */
export function buildOrg(deptRows: DeptRow[], personRows: PersonRow[], syncedAt: string | null = null, company = "이노그리드"): OrgData {
  const derived = deptRows.length === 0;
  const departments: OrgDept[] = [];
  const byPath = new Map<string, string>(); // "부문>본부>팀" → id
  if (!derived) {
    const rows = [...deptRows].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0) || (a.sort ?? 0) - (b.sort ?? 0));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const pathOf = (r: DeptRow): string[] => {
      const names: string[] = [];
      for (let cur: DeptRow | undefined = r, guard = 0; cur && guard < 20; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, guard++) names.unshift(cur.name);
      return names.slice(1); // 회사 루트 제외
    };
    for (const r of rows) {
      departments.push({ id: r.id, parentId: r.parent_id && byId.has(r.parent_id) ? r.parent_id : null, name: r.name, sort: r.sort ?? 0, depth: r.depth ?? 0 });
      byPath.set(pathOf(r).join(">"), r.id);
    }
  } else {
    departments.push({ id: ROOT, parentId: null, name: company, sort: 0, depth: 0 });
    byPath.set("", ROOT);
    let sort = 1;
    const sorted = [...personRows].sort((a, b) => (a.units ?? []).join(">").localeCompare((b.units ?? []).join(">"), "ko"));
    for (const p of sorted) {
      const units = p.units ?? [];
      for (let i = 0; i < units.length; i++) {
        const key = units.slice(0, i + 1).join(">");
        if (byPath.has(key)) continue;
        byPath.set(key, key);
        departments.push({ id: key, parentId: i === 0 ? ROOT : units.slice(0, i).join(">"), name: units[i], sort: sort++, depth: i + 1 });
      }
    }
  }
  const ids = new Set(departments.map((d) => d.id));
  const people: OrgPerson[] = personRows.map((p) => {
    const viaId = p.dept_id && ids.has(p.dept_id) ? p.dept_id : null;
    const deptId = viaId ?? byPath.get((p.units ?? []).join(">")) ?? null;
    return { email: p.email, empSeq: p.emp_seq, name: p.name, deptId, deptName: p.dept_name, duty: p.duty, position: p.position };
  });
  people.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { departments, people, syncedAt, derived };
}

/** 부서 id → 그 부서와 모든 하위 부서 id. */
export function descendants(departments: OrgDept[], id: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const d of departments) if (d.parentId) kids.set(d.parentId, [...(kids.get(d.parentId) ?? []), d.id]);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(kids.get(cur) ?? []));
  }
  return out;
}
