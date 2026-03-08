"use client";

import { useState, useEffect, useCallback } from "react";

export interface UserMember {
  id: string;
  name: string;
  dooray_member_id: string | null;
  is_card_holder: boolean;
  sort_order: number;
}

export function useUserMembers() {
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
    fetchMembers();
  }, [fetchMembers]);

  /** Dooray 가져오기 결과를 DB에 저장 */
  const saveImported = useCallback(
    async (imported: { name: string; dooray_member_id?: string }[]) => {
      const res = await fetch("/api/users/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members: imported }),
      });
      if (res.ok) {
        await fetchMembers();
      }
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
  };
}
