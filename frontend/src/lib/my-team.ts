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

/** 현재 내 팀과 일치하는 소스 항목의 키 집합(이메일 우선, 없으면 이름) */
export function preselectKeys(
  current: { name: string; email?: string | null }[],
  source: Member[]
): Set<string> {
  const byEmail = new Set<string>();
  const byName = new Set<string>();
  for (const c of current) {
    const email = c.email?.trim().toLowerCase();
    if (email) byEmail.add(email);
    else byName.add(c.name.trim());
  }
  const keys = new Set<string>();
  for (const s of source) {
    const email = s.email?.trim().toLowerCase();
    if (email && byEmail.has(email)) keys.add(memberKey(s));
    else if (!email && byName.has(s.name.trim())) keys.add(memberKey(s));
    else if (email && byName.has(s.name.trim())) keys.add(memberKey(s)); // 이메일 없는 기존 항목을 이름으로 매칭
  }
  return keys;
}

/**
 * 현재 내 팀을 소스와 대조: 소스에 있는 사람은 미리 체크(preselected = 소스 항목 키),
 * 소스에 없는 사람(수동 추가/퇴사 등)은 extras로 유지한다.
 */
export function splitCurrent(
  current: { name: string; email?: string | null; external_id?: string | null }[],
  source: Member[]
): { preselected: Set<string>; extras: TeamMemberDraft[] } {
  const preselected = preselectKeys(current, source);
  const srcEmails = new Set(source.map((s) => s.email?.trim().toLowerCase()).filter(Boolean) as string[]);
  const srcNames = new Set(source.map((s) => s.name.trim()));
  const extras: TeamMemberDraft[] = [];
  for (const c of current) {
    const email = c.email?.trim().toLowerCase();
    const matched = email ? srcEmails.has(email) : srcNames.has(c.name.trim());
    if (matched) continue;
    extras.push(email ? { name: c.name.trim(), email, external_id: c.external_id ?? undefined } : { name: c.name.trim() });
  }
  return { preselected, extras };
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
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

/** 소스 Member → 저장용 draft (소스 id는 external_id로 보존) */
export function toDrafts(selected: Member[]): TeamMemberDraft[] {
  return selected.map((m) => ({ name: m.name, email: m.email, external_id: m.id }));
}

/** user_members 행 → 점심 모달 등에서 쓰는 Member (id = external_id ?? 행 id) */
export function userMembersToMembers(rows: UserMemberLike[]): Member[] {
  return rows.map((r) => ({ id: r.external_id || r.id, name: r.name, email: r.email || undefined }));
}
