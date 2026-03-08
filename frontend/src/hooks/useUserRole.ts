"use client";

import { useState, useEffect } from "react";
import type { UserRole } from "@/lib/roles";

let cachedRole: UserRole | null = null;

export function useUserRole() {
  const [role, setRole] = useState<UserRole>(cachedRole ?? "user");
  const [loading, setLoading] = useState(cachedRole === null);

  useEffect(() => {
    if (cachedRole !== null) return;

    fetch("/api/users/role")
      .then((res) => res.json())
      .then((data) => {
        const r = data.role ?? "user";
        cachedRole = r;
        setRole(r);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const invalidate = () => {
    cachedRole = null;
    setLoading(true);
    fetch("/api/users/role")
      .then((res) => res.json())
      .then((data) => {
        const r = data.role ?? "user";
        cachedRole = r;
        setRole(r);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  return { role, loading, isAdmin: role === "admin", invalidate };
}
