"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase";
import type { UserRole } from "@/lib/roles";
import { canOpenPage, isPagePermissions, type PagePermissions } from "@/lib/page-access";

type Snapshot = { role: UserRole; permissions: PagePermissions; loading: boolean; error: boolean };
const initial: Snapshot = { role: "guest", permissions: {}, loading: true, error: false };
let snapshot = initial;
let generation = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (next: Snapshot) => { snapshot = next; listeners.forEach((l) => l()); };

async function refresh(force = false) {
  if (pending && !force) return pending;
  const ticket = ++generation;
  const task = (async () => {
    try {
      const response = await fetch("/api/users/role", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !["guest", "user", "admin"].includes(data.role) || !isPagePermissions(data.permissions)) throw new Error("권한 확인 실패");
      if (ticket === generation) publish({ role: data.role, permissions: data.permissions, loading: false, error: false });
    } catch {
      if (ticket === generation) publish({ role: "guest", permissions: {}, loading: false, error: true });
    } finally { if (ticket === generation) pending = null; }
  })();
  pending = task;
  return task;
}

let consumers = 0;
let stop: (() => void) | undefined;
function start() {
  if (++consumers !== 1) return;
  void refresh();
  const onFocus = () => { void refresh(); };
  const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
  window.addEventListener("focus", onFocus);
  window.addEventListener("page-access-updated", onFocus);
  const { data: { subscription } } = createClient().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") {
      ++generation; pending = null; publish(initial);
      queueMicrotask(() => { void refresh(true); });
    }
  });
  stop = () => { clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("page-access-updated", onFocus); subscription.unsubscribe(); };
}

export function useUserRole() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => initial);
  useEffect(() => {
    start();
    return () => { if (--consumers === 0) { stop?.(); stop = undefined; ++generation; pending = null; snapshot = initial; } };
  }, []);
  return { ...state, isAdmin: !state.loading && !state.error && state.role === "admin",
    canAccessPage: (path: string) => !state.loading && !state.error && canOpenPage(state.role, path, state.permissions),
    invalidate: () => refresh(true),
  };
}
