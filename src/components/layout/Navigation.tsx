"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Dice5, Users, Settings, Home, LogOut, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import type { User } from "@supabase/supabase-js";
import { logAction } from "@/lib/action-log";

const NAV_ITEMS = [
  { href: "/", label: "홈", icon: Home },
  { href: "/ladder", label: "사다리", icon: Dice5 },
  { href: "/team", label: "팀 구성", icon: Users },
  { href: "/food", label: "뭐 먹지", icon: UtensilsCrossed },
  { href: "/settings", label: "설정", icon: Settings },
];

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

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

  return (
    <>
      {/* Desktop top nav */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4">
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
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
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

            <div className="ml-auto flex items-center gap-2">
              {user && (
                <>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {user.user_metadata?.full_name || user.email}
                  </span>
                  {user.user_metadata?.avatar_url && (
                    <img
                      src={user.user_metadata.avatar_url}
                      alt=""
                      className="h-7 w-7 rounded-full"
                    />
                  )}
                  <Button variant="ghost" size="sm" onClick={handleLogout} className="h-8 px-2">
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-xl safe-area-bottom">
        <div className="flex items-center justify-around h-14 px-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg text-[10px] font-medium transition-colors min-w-0",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground"
                )}
              >
                <Icon className={cn("h-5 w-5", isActive && "text-primary")} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
