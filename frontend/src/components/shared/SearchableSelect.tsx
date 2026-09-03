"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  label: string;
  /** 같은 group끼리 묶어 소제목으로 표시 */
  group?: string;
  /** 오른쪽 보조 텍스트(건수 등) */
  hint?: string;
}

/**
 * 검색(autocomplete) 되는 단일 선택 콤보박스 — 옵션이 많은 필터(조직/팀 등)에 Select 대신 쓴다.
 * 입력값과 라벨을 소문자로 비교해 전치 일치를 먼저, 부분 일치를 그다음에 보여준다(cmdk 기본 퍼지 매칭 대신).
 */
export default function SearchableSelect({
  value, onChange, options, placeholder = "선택", searchPlaceholder = "검색…", emptyText = "일치하는 항목이 없습니다", className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const groups = useMemo(() => {
    const order: (string | undefined)[] = [];
    const by = new Map<string | undefined, SearchableOption[]>();
    for (const o of options) {
      if (!by.has(o.group)) { by.set(o.group, []); order.push(o.group); }
      by.get(o.group)!.push(o);
    }
    return order.map((g) => ({ name: g, items: by.get(g)! }));
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className={cn("h-8 justify-between px-3 text-xs font-normal", className)}>
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="min-w-[220px] p-0" style={{ width: "var(--radix-popover-trigger-width)" }} align="start">
        <Command filter={rankMatch}>
          <CommandInput placeholder={searchPlaceholder} className="h-8 text-xs" />
          <CommandList className="max-h-[320px]">
            <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">{emptyText}</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.name ?? "__root"} heading={g.name}>
                {g.items.map((o) => (
                  <CommandItem key={o.value} value={o.value} keywords={[o.label]} onSelect={() => { onChange(o.value); setOpen(false); }} className="text-xs">
                    <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", value === o.value ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="ml-auto pl-2 text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** cmdk filter: 라벨(keywords)에 대해 전치 일치 2점, 부분 일치 1점, 불일치 0점(숨김). 값(value)은 내부 키라 비교하지 않는다 */
export function rankMatch(_value: string, search: string, keywords?: string[]): number {
  const q = search.trim().toLowerCase();
  if (!q) return 1;
  const hay = (keywords ?? []).map((k) => k.toLowerCase());
  if (hay.some((h) => h.startsWith(q))) return 2;
  if (hay.some((h) => h.includes(q))) return 1;
  return 0;
}
