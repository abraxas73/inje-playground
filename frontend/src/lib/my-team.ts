/**
 * "내 팀 구성" 순수 로직 — 사용자별 명단(user_members)과 멤버 소스(앱 사용자 명단/Teams/Dooray)를 잇는다.
 * 매칭 키: 이메일(소문자) 우선, 없으면 "name:이름".
 */
import type { Member } from "@/lib/members/types";

export interface TeamMemberDraft {
  name: string;
  email?: string;
  external_id?: string;
}

export interface UserMemberLike {
  id: string;
  name: string;
  email?: string | null;
  external_id?: string | null;
}

export function memberKey(m: { name: string; email?: string | null }): string {
  const email = m.email?.trim().toLowerCase();
  return email ? email : `name:${m.name.trim()}`;
}

/**
 * 현재 내 팀을 소스와 대조한다.
 * - 매칭 우선순위: external_id(소스 id) → 이메일 → 이름(소스에 그 이름이 유일할 때만; 동명이인은 매칭하지 않음)
 * - preselectedIds: 미리 체크할 소스 id
 * - overrides: 저장된 이메일이 소스 이메일과 다르면(예: 로그인은 gmail, Teams는 회사 메일) 그 값을 복원
 * - extras: 소스에 없는 사람(직접 추가/퇴사 등)은 직접 추가 항목으로 유지
 */
export function splitCurrent(
  current: { name: string; email?: string | null; external_id?: string | null }[],
  source: Member[]
): { preselectedIds: Set<string>; overrides: Record<string, string>; extras: TeamMemberDraft[] } {
  const byId = new Map(source.map((s) => [s.id, s]));
  const byEmail = new Map<string, Member>();
  const byName = new Map<string, Member[]>();
  for (const s of source) {
    const email = s.email?.trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, s);
    const name = s.name.trim();
    byName.set(name, [...(byName.get(name) ?? []), s]);
  }

  const preselectedIds = new Set<string>();
  const overrides: Record<string, string> = {};
  const extras: TeamMemberDraft[] = [];

  for (const c of current) {
    const name = c.name.trim();
    const email = c.email?.trim().toLowerCase() || undefined;
    let match: Member | undefined;
    if (c.external_id && byId.has(c.external_id)) match = byId.get(c.external_id);
    else if (email && byEmail.has(email)) match = byEmail.get(email);
    else {
      const candidates = byName.get(name) ?? [];
      if (candidates.length === 1) match = candidates[0];
    }

    if (match) {
      preselectedIds.add(match.id);
      const srcEmail = match.email?.trim().toLowerCase();
      if (email && email !== srcEmail) overrides[match.id] = email;
    } else {
      extras.push(email ? { name, email } : { name });
    }
  }
  return { preselectedIds, overrides, extras };
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "naver.com",
  "daum.net",
  "hanmail.net",
  "kakao.com",
  "nate.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "yahoo.com",
  "yahoo.co.kr",
]);

/** 개인 메일 도메인이면 true — Teams DM은 테넌트(회사) 이메일로만 가므로 경고용 */
export function isPersonalEmail(email: string | null | undefined): boolean {
  const domain = email?.trim().toLowerCase().split("@")[1];
  return !!domain && PERSONAL_EMAIL_DOMAINS.has(domain);
}

/** 수동 추가: 공백 정리, 같은 키(이메일/이름)는 덮어쓰기, 이름이 비면 무시 */
export function mergeManual(list: TeamMemberDraft[], manual: TeamMemberDraft): TeamMemberDraft[] {
  const name = manual.name.trim();
  if (!name) return list;
  const email = manual.email?.trim().toLowerCase() || undefined;
  const draft: TeamMemberDraft = email ? { name, email } : { name };
  const key = memberKey(draft);
  const idx = list.findIndex((m) => memberKey(m) === key);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = { ...list[idx], ...draft };
    return next;
  }
  return [...list, draft];
}

/** 소스 Member → 저장용 draft (소스 id는 external_id로 보존; overrides가 있으면 그 이메일 사용) */
export function toDrafts(selected: Member[], overrides: Record<string, string> = {}): TeamMemberDraft[] {
  return selected.map((m) => ({
    name: m.name,
    email: overrides[m.id]?.trim().toLowerCase() || m.email,
    external_id: m.id,
  }));
}

/** user_members 행 → 점심 모달 등에서 쓰는 Member (id = external_id ?? 행 id) */
export function userMembersToMembers(rows: UserMemberLike[]): Member[] {
  return rows.map((r) => ({ id: r.external_id || r.id, name: r.name, email: r.email || undefined }));
}
