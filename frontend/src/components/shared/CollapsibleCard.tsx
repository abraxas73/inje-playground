"use client";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * 모바일(md 미만)에서는 접힌 채 시작하는 카드. 데스크톱(md 이상)에서는 항상 펼쳐져 있고 토글도 보이지 않는다.
 * 본문을 DOM에 두고 `hidden md:block`으로만 숨겨, 서버 렌더와 하이드레이션이 어긋나지 않는다. 모바일은 위아래 여백을 줄인다(py-3).
 */
export function CollapsibleCard({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={cn("py-3 md:py-6", className)}>
      <CardContent className="pt-0 md:pt-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 font-semibold">{title}</h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:hidden"
            aria-expanded={open}
            aria-label={open ? "접기" : "펼치기"}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
        <div className={cn("mt-3 space-y-3", open ? "block" : "hidden md:block")}>{children}</div>
      </CardContent>
    </Card>
  );
}
