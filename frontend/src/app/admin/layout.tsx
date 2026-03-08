"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Shield, Users, Settings, HelpCircle, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/useUserRole";

const ADMIN_NAV = [
  { href: "/admin/users", label: "사용자 관리", icon: Users },
  { href: "/admin/settings", label: "시스템 설정", icon: Settings },
  { href: "/admin/guide", label: "가이드 관리", icon: HelpCircle },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, loading, isAdmin } = useUserRole();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        권한 확인 중...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p className="text-sm">관리자 권한이 필요합니다.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center">
          <Shield className="h-5 w-5 text-slate-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">어드민</h1>
          <p className="text-sm text-muted-foreground">시스템 관리</p>
        </div>
      </div>

      {/* Sub-nav tabs */}
      <div className="flex gap-1 mb-6 bg-muted/50 rounded-xl p-1 w-fit">
        {ADMIN_NAV.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
