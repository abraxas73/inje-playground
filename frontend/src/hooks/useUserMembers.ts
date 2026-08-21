"use client";

import { useState, useEffect, useCallback } from "react";

export interface UserMember {
  id: string;
  name: string;
  dooray_member_id: string | null;
  email: string | null;
  external_id: string | null;
  is_card_holder: boolean;
  sort_order: number;
}

export interface ImportedMember {
  name: string;
  dooray_member_id?: string;
  email?: string;
  external_id?: string;
}

export function useUserMembers(enabled = true) {
  const [members, setMembers] = useState<UserMember[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/users/members");
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) fetchMembers();
    else setLoading(false);
  }, [enabled, fetchMembers]);

  /** 내 팀 명단 저장(가져오기/선택 결과로 기존 목록 교체) */
  const saveImported = useCallback(
    async (imported: ImportedMember[]) => {
      const res = await fetch("/api/users/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members: imported }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `내 팀 저장 실패 (${res.status})`);
      }
      await fetchMembers();
    },
    [fetchMembers]
  );

  /** 법카 토글 */
  const toggleCardHolder = useCallback(
    async (name: string) => {
      const member = members.find((m) => m.name === name);
      if (!member) return;
      const newVal = !member.is_card_holder;

      // Optimistic update
      setMembers((prev) =>
        prev.map((m) =>
          m.name === name ? { ...m, is_card_holder: newVal } : m
        )
      );

      await fetch("/api/users/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, is_card_holder: newVal }),
      });
    },
    [members]
  );

  /** 구성원 제외 (행 id 기준 — 동명이인 안전) */
  const removeMember = useCallback(
    async (member: Pick<UserMember, "id">) => {
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      await fetch(`/api/users/members?id=${encodeURIComponent(member.id)}`, { method: "DELETE" });
      await fetchMembers();
    },
    [fetchMembers]
  );

  const names = members.map((m) => m.name);
  const cardHolders = new Set(
    members.filter((m) => m.is_card_holder).map((m) => m.name)
  );

  return {
    members,
    names,
    cardHolders,
    loading,
    fetchMembers,
    saveImported,
    toggleCardHolder,
    removeMember,
  };
}
