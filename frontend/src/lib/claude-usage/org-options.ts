import type { ClaudeOrg, OrgCategory, UserEnv } from "@/types/claude-usage";

/** 조직 필터 값 — 개인 조직 전체 묶음 */
export const PERSONAL_ORGS = "personal";
export const PERSONAL_LABEL = "기타(개인 계정)";
export const UNKNOWN_LABEL = "계정 정보 없는 세션";

/** category가 아직 없는 응답(2026-09-16 SQL 이전)은 이름 규칙으로 보정: unknown·test-org=system, UUID 앞 8자 이름=personal, 그 외 team */
export function orgCategory(o: Pick<ClaudeOrg, "id" | "name" | "category">): OrgCategory {
  if (o.category) return o.category;
  if (o.id === "unknown" || o.id === "test-org") return "system";
  return o.name === o.id.slice(0, 8) ? "personal" : "team";
}

export interface OrgOption { value: string; label: string }

/**
 * 드롭다운 항목: 전체 → Team 조직(정렬순) → [기타(개인 계정) N] → [계정 정보 없는 세션].
 * OTel 기반 탭(Code·팀별·도구·시간대·프롬프트)은 personal·unknown을 켜고, CSV·Office 탭은 Team 조직만 쓴다.
 */
export function orgSelectOptions(orgs: ClaudeOrg[], include: { personal?: boolean; unknown?: boolean } = {}): OrgOption[] {
  const team = orgs.filter((o) => orgCategory(o) === "team").sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko"));
  const out: OrgOption[] = [{ value: "all", label: "전체 Claude 조직" }, ...team.map((o) => ({ value: o.id, label: o.name }))];
  const personal = orgs.filter((o) => orgCategory(o) === "personal").length;
  if (include.personal && personal) out.push({ value: PERSONAL_ORGS, label: `${PERSONAL_LABEL} ${personal}개` });
  if (include.unknown && orgs.some((o) => o.id === "unknown")) out.push({ value: "unknown", label: UNKNOWN_LABEL });
  return out;
}

/** 사용자 행의 Claude 조직 배지 */
export function orgBadgeLabel(id: string, orgs: Map<string, ClaudeOrg>): string {
  if (id === "unknown") return "조직 미확인";
  const o = orgs.get(id);
  if (!o) return id.slice(0, 8);
  return orgCategory(o) === "personal" ? `개인 계정 ${o.name}` : o.name;
}

/** 계정 속성이 없는 텔레메트리 표기 — unknown / uuid: / id: 로 들어온 사용자 키 */
export function displayUser(email: string): string {
  if (email === "unknown") return `${UNKNOWN_LABEL} (식별자 없음)`;
  if (email.startsWith("id:")) return `${UNKNOWN_LABEL} ${email.slice(3, 11)}…`;
  if (email.startsWith("uuid:")) return `계정 ${email.slice(5, 13)}…`;
  return email;
}

const OS_NAMES: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows", windows: "Windows" };

/** "macOS/arm64 · iTerm.app · v2.1.32" — 빈 값은 생략, 전부 비면 "—" */
export function formatEnv(e: UserEnv | undefined): string {
  if (!e) return "—";
  const os = e.os_type ? OS_NAMES[e.os_type] ?? e.os_type : "";
  const platform = [os, e.host_arch].filter(Boolean).join("/");
  const parts = [platform, e.terminal_type, e.app_version ? `v${e.app_version}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

/** 컨테이너·웹 세션 추정: Linux + 터미널 없음 */
export function looksHeadlessLinux(e: UserEnv | undefined): boolean {
  return !!e && e.os_type === "linux" && !e.terminal_type;
}
