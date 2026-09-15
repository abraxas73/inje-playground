"use client";
import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Organization } from "@/lib/marketing/types";
import { api, errorMessage } from "./shared";
interface Matches { rows: Organization[]; total: number; pageSize: number }
export default function ContactOrganizationPicker({ value, initialName = "", disabled, onChange }: { value: Organization | null; initialName?: string; disabled?: boolean; onChange: (org: Organization | null) => void }) {
  const id = useId(); const [query, setQuery] = useState(initialName); const [page, setPage] = useState(1); const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(true); const [active, setActive] = useState(-1);
  const key = JSON.stringify([query.trim(), page, retry]);
  const [result, setResult] = useState<{ key: string; data?: Matches; error?: string }>();
  const current = result?.key === key ? result : undefined;
  const options = current?.data?.rows ?? [];
  useEffect(() => {
    if (value || !query.trim()) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      api<Matches>(`/api/marketing/organizations?q=${encodeURIComponent(query.trim())}&page=${page}`, undefined, abort.signal)
        .then(data => { if (!abort.signal.aborted) setResult({ key, data }); })
        .catch(e => { if (!abort.signal.aborted) setResult({ key, error: errorMessage(e) }); });
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, page, key, value]);
  function pick(org: Organization) { onChange(org); setQuery(org.name); setOpen(false); setActive(-1); }
  return <div className="space-y-2 sm:col-span-2">
    <label htmlFor={id} className="text-sm font-medium">회사명 *</label>
    <Input id={id} role="combobox" aria-autocomplete="list" aria-expanded={!value && open && !!query.trim()} aria-controls={`${id}-options`} aria-activedescendant={active >= 0 && options[active] ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help`} autoComplete="off" disabled={disabled} value={value?.name ?? query} maxLength={2000} placeholder="회사·기관명 또는 승인 별칭 검색" onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setPage(1); setActive(-1); setOpen(true); onChange(null); }} onKeyDown={e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setActive(a => Math.max(0, Math.min(options.length - 1, a + (e.key === "ArrowDown" ? 1 : -1)))); }
      if (e.key === "Enter") { e.preventDefault(); if (open && options[active]) pick(options[active]); }
    }}/>
    {value ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm"><span>선택됨 · {value.name} · {value.category} · {value.review_status === "confirmed" ? "확인 완료" : "확인 필요"}</span><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { onChange(null); setOpen(true); setRetry(v => v + 1); }}>다른 회사 선택</Button></div> : open && query.trim() && <div className="rounded-lg border bg-card p-2 space-y-2">
      {!current && <p role="status" className="p-2 text-sm text-muted-foreground">회사·기관 검색 중…</p>}
      {current?.error && <div role="alert" className="text-sm text-destructive">{current.error}<Button type="button" variant="ghost" size="sm" onClick={() => setRetry(v => v + 1)}>다시 검색</Button></div>}
      <div id={`${id}-options`} role="listbox" aria-label="회사·기관 검색 결과" className="max-h-56 overflow-y-auto">{options.map((org, i) => <button type="button" role="option" aria-selected={active === i} id={`${id}-option-${i}`} key={org.id} disabled={disabled} className={`block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted ${active === i ? "bg-muted" : ""}`} onMouseDown={e => e.preventDefault()} onClick={() => pick(org)}><span className="font-medium">{org.name}</span><span className="ml-2 text-muted-foreground">{org.category} · {org.review_status === "confirmed" ? "확인 완료" : "확인 필요"}</span><span className="block text-xs text-muted-foreground">{org.aliases.length > 0 ? `별칭: ${org.aliases.join(", ")}` : ""}{options.filter(o => o.name === org.name).length > 1 ? ` · 회사·기관 ID: ${org.id}` : ""}</span></button>)}</div>
      {current?.data && !options.length && <p className="p-2 text-sm">등록된 회사·기관이 없습니다. 회사·기관에 먼저 등록해 주세요.</p>}
      {current?.data && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { setRetry(v => v + 1); setActive(-1); }}>회사·기관 다시 검색</Button>}
      {(current?.data?.total ?? 0) > 25 && <div className="flex items-center justify-between text-xs"><Button type="button" variant="ghost" size="sm" disabled={page === 1} onClick={() => { setPage(p => p - 1); setActive(-1); }}>이전 검색 결과</Button><span>{page} / {Math.ceil(current!.data!.total / 25)} 페이지</span><Button type="button" variant="ghost" size="sm" disabled={page * 25 >= current!.data!.total} onClick={() => { setPage(p => p + 1); setActive(-1); }}>다음 검색 결과</Button></div>}
    </div>}
    <p id={`${id}-help`} className="text-xs text-muted-foreground">검색 결과를 선택해야 제출할 수 있습니다. 새 회사는 <a className="text-primary underline underline-offset-2" href="/marketing?view=organizations" target="_blank" rel="noopener noreferrer">회사·기관에서 먼저 등록 (새 탭)</a>한 뒤 이 창에서 다시 검색하세요. 입력 중인 Contact는 유지됩니다.</p>
    {!value && <p className="text-xs text-amber-700">회사·기관을 선택해 주세요. 비슷한 회사명도 별도 법인일 수 있습니다.</p>}
  </div>;
}
