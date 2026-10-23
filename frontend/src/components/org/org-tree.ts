/** 조직도 화면용 순수 계산 — 부서 색인(자식·인원 수), 경로, 검색. */
import type { OrgData, OrgDept, OrgPerson } from "@/lib/directory/org";

export interface OrgIndex {
  root: OrgDept;
  byId: Map<string, OrgDept>;
  children: Map<string, OrgDept[]>;
  direct: Map<string, number>;
  total: Map<string, number>;
}

export function indexOrg(data: OrgData): OrgIndex {
  const byId = new Map(data.departments.map((d) => [d.id, d]));
  const children = new Map<string, OrgDept[]>();
  for (const d of data.departments) if (d.parentId) children.set(d.parentId, [...(children.get(d.parentId) ?? []), d]);
  for (const list of children.values()) list.sort((a, b) => a.sort - b.sort);
  const direct = new Map<string, number>();
  for (const p of data.people) if (p.deptId) direct.set(p.deptId, (direct.get(p.deptId) ?? 0) + 1);
  const total = new Map<string, number>();
  const count = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0; // 순환 방지
    seen.add(id);
    const n = (direct.get(id) ?? 0) + (children.get(id) ?? []).reduce((s, c) => s + count(c.id, seen), 0);
    total.set(id, n);
    return n;
  };
  const root = data.departments.find((d) => d.parentId === null) ?? data.departments[0];
  count(root.id, new Set());
  return { root, byId, children, direct, total };
}

/** 부서 id의 조상 id(루트부터, 자기 자신 제외). */
export function ancestorIds(idx: OrgIndex, id: string): string[] {
  const out: string[] = [];
  for (let cur = idx.byId.get(id)?.parentId ?? null, guard = 0; cur && guard < 30; cur = idx.byId.get(cur)?.parentId ?? null, guard++) out.unshift(cur);
  return out;
}

export function deptPath(idx: OrgIndex, id: string): string {
  return [...ancestorIds(idx, id), id].map((x) => idx.byId.get(x)?.name ?? "").join(" > ");
}

/** 기본 펼침: 루트 + 1단계 + 2단계 부서. */
export function defaultExpanded(idx: OrgIndex): Set<string> {
  const out = new Set([idx.root.id]);
  for (const c of idx.children.get(idx.root.id) ?? []) {
    out.add(c.id);
    for (const g of idx.children.get(c.id) ?? []) out.add(g.id);
  }
  return out;
}

/** 검색: 부서 이름 일치 + 이름·이메일이 맞는 사람이 속한 부서를 강조, 그 조상은 펼친다. */
export function searchOrg(idx: OrgIndex, people: OrgPerson[], query: string) {
  const q = query.trim().toLowerCase();
  const depts = new Set<string>();
  const expand = new Set<string>();
  if (!q) return { depts, people: [] as OrgPerson[], expand };
  for (const d of idx.byId.values()) if (d.name.toLowerCase().includes(q)) depts.add(d.id);
  const byPerson = (p: OrgPerson) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
  for (const p of people) if (p.deptId && byPerson(p)) depts.add(p.deptId);
  // 표: 이름·이메일 일치 + 이름이 맞는 부서(하위 제외)의 직속 직원
  const matched = people.filter((p) => byPerson(p) || (p.deptId !== null && depts.has(p.deptId) && idx.byId.get(p.deptId)!.name.toLowerCase().includes(q)));
  for (const id of depts) for (const a of ancestorIds(idx, id)) expand.add(a);
  return { depts, people: matched, expand };
}

export const byName = (a: OrgPerson, b: OrgPerson) => a.name.localeCompare(b.name, "ko");

/** 앱(WebView) 네이티브 화면 열기 — 같은 사이트 /app-action 이동을 앱이 가로챈다(mobile/lib/web/app_actions.dart).
 * messenger: 사번(emp)·이름(names), mail: 주소(to). 사번 없는 사람은 메신저에서 뺀다. */
export function appActionUrl(kind: "messenger" | "mail", people: { email: string; empSeq: string | null; name: string }[]): string {
  const q = new URLSearchParams({ kind });
  if (kind === "messenger") {
    const withSeq = people.filter((p) => p.empSeq);
    q.set("emp", withSeq.map((p) => p.empSeq).join(","));
    q.set("names", withSeq.map((p) => p.name).join(","));
  } else {
    q.set("to", people.map((p) => p.email).join(","));
  }
  return `/app-action?${q.toString()}`;
}

/** 브라우저 메일 — mailto(여러 명은 쉼표). */
export const mailtoUrl = (people: { email: string }[]) => `mailto:${people.map((p) => p.email).join(",")}`;
