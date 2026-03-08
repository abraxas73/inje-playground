"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Redirect old /guide/admin to /admin/guide */
export default function GuideAdminRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/guide");
  }, [router]);
  return null;
}
