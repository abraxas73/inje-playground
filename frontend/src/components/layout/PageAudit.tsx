"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { auditPagePath } from "@/lib/audit-page";

/** Observe committed navigation, not Next.js prefetch requests. */
export default function PageAudit() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const path = auditPagePath(pathname);
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (!path) return;
    void fetch("/api/page-views", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }), keepalive: true,
    }).catch(() => {});
  }, [pathname]);
  return null;
}
