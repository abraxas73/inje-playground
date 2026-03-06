"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dice5, Users, Settings, Home, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "홈", icon: Home },
  { href: "/ladder", label: "사다리 게임", icon: Dice5 },
  { href: "/team", label: "팀 나누기", icon: Users },
  { href: "/settings", label: "설정", icon: Settings },
];

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center h-16 gap-1">
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-lg tracking-tight mr-8 group"
          >
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center group-hover:scale-110 transition-transform">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="gradient-text font-extrabold">Coneplus</span>
          </Link>
          <div className="flex items-center gap-0.5 bg-muted/50 rounded-xl p-1">
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
        </div>
      </div>
    </nav>
  );
}
