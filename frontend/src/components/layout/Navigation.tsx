"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Dice5, LogOut, UtensilsCrossed, HelpCircle, Coffee, Shield, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { User } from "@supabase/supabase-js";
import { logAction } from "@/lib/action-log";
import { useUserRole } from "@/hooks/useUserRole";
import type { UserRole } from "@/lib/roles";
import { canAccess } from "@/lib/roles";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole?: UserRole; // minimum role required (default: all)
}

const NAV_ITEMS: NavItem[] = [
  { href: "/food", label: "뭐 먹지", icon: UtensilsCrossed },
  { href: "/guide", label: "가이드", icon: HelpCircle, minRole: "user" },
  { href: "/ladder", label: "사다리", icon: Dice5 },
  { href: "/team", label: "커피 타임", icon: Coffee },
  { href: "/admin", label: "어드민", icon: Shield, minRole: "admin" },
];

const ROLE_PRIORITY: Record<UserRole, number> = { guest: 0, user: 1, admin: 2 };

function hasMinRole(userRole: UserRole, minRole?: UserRole): boolean {
  if (!minRole) return true;
  return ROLE_PRIORITY[userRole] >= ROLE_PRIORITY[minRole];
}

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const { role } = useUserRole();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null)
    );
    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    logAction("로그아웃", "auth");
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (pathname === "/login") return null;

  const visibleItems = NAV_ITEMS.filter((item) => hasMinRole(role, item.minRole));
  const mobileItems = visibleItems.filter((item) => item.minRole !== "admin");

  return (
    <>
      {/* Desktop top nav */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="flex items-center h-14 md:h-16 gap-1">
            <Link
              href="/"
              className="flex items-center mr-4 md:mr-8 group shrink-0"
            >
              <Image
                src="/logo.svg"
                alt="NHN InjeInc"
                width={120}
                height={14}
                className="group-hover:opacity-80 transition-opacity"
              />
            </Link>

            {/* Desktop nav items */}
            <div className="hidden md:flex items-center gap-0.5 bg-muted/50 rounded-xl p-1">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <div className="ml-auto flex items-center">
              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60 transition-colors cursor-pointer outline-none">
                      <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[120px]">
                        {user.user_metadata?.full_name || user.email}
                      </span>
                      {user.user_metadata?.avatar_url ? (
                        <img
                          src={user.user_metadata.avatar_url}
                          alt=""
                          className="h-7 w-7 rounded-full"
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                          <UserIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => router.push("/profile")}>
                      <UserIcon className="h-4 w-4 mr-2" />
                      프로필
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout}>
                      <LogOut className="h-4 w-4 mr-2" />
                      로그아웃
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-xl safe-area-bottom">
        <div className={cn(
          "grid h-14 px-1",
          mobileItems.length <= 3 ? "grid-cols-3" : "grid-cols-4"
        )}>
          {mobileItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                <Icon className={cn("h-5 w-5", isActive && "text-primary")} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
