"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Dice5, LogOut, UtensilsCrossed, Coffee, Shield, User as UserIcon, Settings, BookOpen, ClipboardList, SquareTerminal, MessagesSquare, TrendingUp, FileSearch, Newspaper, ChevronDown, Users, BriefcaseBusiness, ChartNoAxesCombined } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";
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
import { PAGE_GROUPS, PAGES, matchesPath, pagesForPath, type PageKey } from "@/lib/page-access";

const PAGE_ICONS: Record<PageKey, typeof Coffee> = { food: UtensilsCrossed, ladder: Dice5, team: Coffee, survey: ClipboardList, usage_code: SquareTerminal, usage_chat: MessagesSquare, usage_perf: TrendingUp, rfp: FileSearch, people_news: Newspaper, guide: BookOpen };
const GROUP_ICONS = { daily: Users, ai: ChartNoAxesCombined, work: BriefcaseBusiness };

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const { canAccessPage, isAdmin, loading, error, invalidate } = useUserRole();

  useEffect(() => {
    if (!loading && pagesForPath(pathname).length && !canAccessPage(pathname)) router.replace("/access-denied");
  }, [pathname, loading, canAccessPage, router]);

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

  // 공유 링크 화면은 사외 열람용이라 사내 메뉴를 보여 주지 않는다(눌러도 로그인으로 튕긴다)
  if (pathname === "/login" || pathname === "/privacy" || pathname.startsWith("/rfp/shared/")) return null;

  const groups = PAGE_GROUPS.map((group) => ({ ...group, pages: PAGES.filter((page) => page.group === group.id && !("hidden" in page && page.hidden) && canAccessPage(page.href)) })).filter((group) => group.pages.length > 0);
  function groupMenu(group: typeof groups[number], mobile = false) {
    const Icon = GROUP_ICONS[group.id];
    const active = group.pages.some((page) => matchesPath(pathname, page.href));
    return <DropdownMenu key={group.id}>
      <DropdownMenuTrigger asChild>
        <button className={cn(mobile ? "flex flex-1 flex-col items-center justify-center gap-1 px-2 text-[11px] font-medium" : "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium", active ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          <Icon className={mobile ? "h-5 w-5" : "h-4 w-4"} /><span>{group.label}</span>{!mobile && <ChevronDown className="h-3 w-3" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={mobile ? "top" : "bottom"} align="start" sideOffset={8} className="w-52">
        {group.pages.map((page) => { const PageIcon = PAGE_ICONS[page.key]; return <DropdownMenuItem key={page.key} asChild>
          <Link href={page.href} aria-current={matchesPath(pathname, page.href) ? "page" : undefined} className={cn("gap-2", matchesPath(pathname, page.href) && "bg-primary/10 text-primary")}><PageIcon className="h-4 w-4" />{page.label}</Link>
        </DropdownMenuItem>; })}
      </DropdownMenuContent>
    </DropdownMenu>;
  }

  return (
    <>
      {/* Desktop top nav */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="max-w-full mx-auto px-4 md:px-8">
          <div className="flex items-center h-14 md:h-16 gap-1">
            <Link
              href="/"
              className="flex items-center mr-4 md:mr-8 group shrink-0"
            >
              <Image
                src="/logo.svg"
                alt="이노그리드"
                width={101}
                height={14}
                className="group-hover:opacity-80 transition-opacity"
              />
            </Link>

            {/* Desktop nav items */}
            <div className="hidden min-w-0 md:flex items-center gap-0.5 bg-muted/50 rounded-xl p-1">
              {groups.map((group) => groupMenu(group))}
              {isAdmin && <Link href="/admin" className={cn("flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium", matchesPath(pathname, "/admin") ? "bg-background shadow-sm" : "text-muted-foreground")}><Shield className="h-4 w-4" />어드민</Link>}
            </div>
            {error && <button className="text-xs text-destructive" onClick={() => void invalidate()}>권한 확인 재시도</button>}

            <div className="ml-auto flex shrink-0 items-center">
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
                    {isAdmin && <DropdownMenuItem asChild><Link href="/admin"><Shield className="h-4 w-4 mr-2" />어드민</Link></DropdownMenuItem>}
                    <DropdownMenuItem onClick={() => router.push("/profile")}>
                      <UserIcon className="h-4 w-4 mr-2" />
                      프로필
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/settings")}>
                      <Settings className="h-4 w-4 mr-2" />
                      설정
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => router.push("/manual")}>
                      <BookOpen className="h-4 w-4 mr-2" />
                      사용자 매뉴얼
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
        <div className="flex h-14 overflow-x-auto px-1">
          {groups.map((group) => groupMenu(group, true))}
        </div>
      </nav>
    </>
  );
}
