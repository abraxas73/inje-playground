"use client";
import OrgChart from "@/components/org/OrgChart";

/** 사내 조직도 — 그룹웨어(아마란스) 부서 트리 + 재직자(GET /api/directory/org). */
export default function OrgPage() {
  return <OrgChart />;
}
