"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink, Globe, Loader2, Lock, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { VERDICT_ACCENT, VERDICT_CLASS } from "@/components/rfp/MappingSummary";
import { groupRowsByDetail } from "@/lib/rfp/mapping/detail-groups";
import { parseDetailUnits } from "@/lib/rfp/mapping/detail-items";
import { bestVerdict } from "@/lib/rfp/mapping/summary";
import { UNMAPPED_LABEL, VERDICT_LABEL, VERDICT_ORDER, type Verdict } from "@/lib/rfp/mapping/types";
import type { RfpRequirement, SharedMapping, SharedProject } from "@/types/rfp";

const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

/** 요구사항 한 건의 펼친 내용 — 본문 + 세부 항목별 매핑(읽기 전용) */
function RequirementPanel({ requirement, rows }: { requirement: RfpRequirement; rows: SharedMapping[] }) {
  const structure = useMemo(() => parseDetailUnits(requirement.details), [requirement.details]);
  const groups = useMemo(() => groupRowsByDetail(rows, structure), [rows, structure]);
  const multi = groups.length > 1 || groups[0]?.key !== null;

  return (
    <div className="space-y-3 border-t bg-muted/20 px-3 py-3 sm:px-4">
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[6rem_1fr]">
        {([["정의", requirement.definition], ["세부 내용", requirement.details], ["산출정보", requirement.deliverables], ["관련 요구사항", requirement.related]] as const)
          .filter(([, v]) => v?.trim())
          .map(([label, v]) => (
            <div key={label} className="contents">
              <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
              <dd className="whitespace-pre-wrap break-words">{v}</dd>
            </div>
          ))}
      </dl>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          솔루션 매핑 {rows.length}행{multi && ` · 세부 항목 ${structure.units.length}개`}
        </div>
        {groups.map((g) => (
          <section key={g.key ?? "__all"} className={cn("overflow-hidden rounded-md border border-l-4 bg-background", VERDICT_ACCENT[bestVerdict(g.rows) ?? "unmapped"])}>
            <div className="flex items-baseline gap-1.5 border-b bg-muted/40 px-2.5 py-1.5">
              {g.key && <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded border bg-background px-1 text-[11px] font-semibold tabular-nums text-muted-foreground">{g.key}</span>}
              <div className="min-w-0 text-sm leading-snug">
                <span className={cn("font-medium", g.key ? "text-foreground" : "text-muted-foreground")}>{g.key ? g.label : multi ? "요구사항 전체" : "매핑"}</span>
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{g.rows.length}행</span>
              </div>
            </div>
            <div className="divide-y">
              {g.rows.length === 0 ? (
                <div className="px-2.5 py-2 text-xs text-muted-foreground">이 세부 항목은 매핑이 없습니다.</div>
              ) : (
                g.rows.map((m) => (
                  <div key={m.id} className="space-y-1 px-2.5 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("border-transparent text-[11px]", VERDICT_CLASS[m.verdict])}>{VERDICT_LABEL[m.verdict]}</Badge>
                      {m.solutionName && <span className="text-xs font-medium">{m.solutionName}</span>}
                      {m.featureName && <span className="min-w-0 truncate text-xs text-muted-foreground">{m.featureName}</span>}
                    </div>
                    {(m.evidenceText || m.rationale) && (
                      <div className="border-l-2 pl-2 text-xs">
                        {m.evidenceText && <div className="text-foreground"><span className="mr-1 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">근거</span>{m.evidenceText}</div>}
                        {m.rationale && <div className="text-muted-foreground">{m.rationale}</div>}
                        {m.note && <div className="mt-0.5 text-amber-800"><span className="mr-1 rounded bg-amber-100 px-1 text-[10px] font-medium">비고</span>{m.note}</div>}
                        {m.evidenceUrl && (
                          <a href={m.evidenceUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-primary hover:underline">
                            바로가기<ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * 공유 링크로 열리는 읽기 전용 화면(로그인 불필요).
 * 편집·업로드·원본 다운로드는 없다 — 서버가 그 데이터를 아예 내려주지 않는다.
 */
export default function SharedProjectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<SharedProject | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "login" | "gone" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rfp/shared/${token}`);
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setData(j as SharedProject);
        setState("ok");
        return;
      }
      const body = j as { error?: string; code?: string };
      setMessage(body.error ?? "열 수 없습니다.");
      setState(body.code === "login_required" ? "login" : res.status === 404 ? "gone" : "error");
    } catch {
      setMessage("네트워크 오류로 불러오지 못했습니다.");
      setState("error");
    }
  }, [token]);

  useEffect(() => {
    // 같은 틱에 setState가 도는 것을 피한다(cascading render 린트 규칙 — 상세 화면과 같은 패턴)
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const byRequirement = useMemo(() => {
    const m = new Map<string, SharedMapping[]>();
    for (const r of data?.mappings ?? []) m.set(r.requirementId, [...(m.get(r.requirementId) ?? []), r]);
    return m;
  }, [data]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const q of data?.requirements ?? []) {
      const best = bestVerdict(byRequirement.get(q.id) ?? []) ?? "unmapped";
      out[best] = (out[best] ?? 0) + 1;
    }
    return out;
  }, [data, byRequirement]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data?.requirements ?? [];
    return (data?.requirements ?? []).filter((r) =>
      [r.reqId, r.title, r.categoryName, r.definition, r.details].some((v) => v?.toLowerCase().includes(needle)),
    );
  }, [data, q]);

  if (state === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />불러오는 중…
      </main>
    );
  }

  if (state !== "ok" || !data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <Image src="/logo.svg" alt="이노그리드" width={130} height={18} priority />
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
        {state === "login" && (
          <Button asChild>
            <Link href={`/login?next=${encodeURIComponent(`/rfp/shared/${token}`)}`}>사내 계정으로 로그인</Link>
          </Button>
        )}
      </main>
    );
  }

  const p = data.project;
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-6">
      {/* 공유 화면임을 먼저 밝힌다 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Image src="/logo.svg" alt="이노그리드" width={90} height={13} />
          <span>공유된 RFP 분석 결과 · 읽기 전용</span>
        </div>
        <Badge variant="outline" className={cn("border-transparent text-[11px]", data.visibility === "public" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700")}>
          {data.visibility === "public" ? <><Globe className="mr-1 h-3 w-3" />공개 링크</> : <><Lock className="mr-1 h-3 w-3" />사내 링크</>}
        </Badge>
      </div>

      <h1 className="text-xl font-bold tracking-tight">{p.name}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        요구사항 {p.requirementCount}건{p.mappingAt ? ` · 매핑 ${fmt(p.mappingAt)}` : ""} · 갱신 {fmt(p.updatedAt)}
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([["발주기관", p.agency], ["사업기간", p.period], ["설계금액", p.budget], ["입찰 및 계약방법", p.bidMethod]] as const)
          .filter(([, v]) => v?.trim())
          .map(([label, v]) => (
            <div key={label} className="rounded-lg border px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 break-words text-sm">{v}</dd>
            </div>
          ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {([...VERDICT_ORDER, "unmapped"] as (Verdict | "unmapped")[]).map((k) => (
          <span key={k} className={cn("inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium", VERDICT_CLASS[k])}>
            {k === "unmapped" ? UNMAPPED_LABEL : VERDICT_LABEL[k]}<span className="tabular-nums">{counts[k] ?? 0}</span>
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ID·명칭·내용 검색" className="h-8 pl-7 text-xs" />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{rows.length}건</span>
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border">
        {rows.map((r, i) => {
          const g = byRequirement.get(r.id) ?? [];
          const best = bestVerdict(g) ?? "unmapped";
          const isOpen = open.has(r.id);
          return (
            <div key={r.id} className={cn("border-b last:border-0", isOpen && "bg-muted/10")}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/30"
                aria-expanded={isOpen}
                onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
              >
                {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="w-8 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="w-28 shrink-0 pt-0.5 text-xs text-muted-foreground">{r.categoryName}</span>
                <span className="w-32 shrink-0 break-all pt-0.5 text-sm font-medium tabular-nums">{r.reqId}</span>
                <span className="min-w-0 flex-1 text-sm">{r.title}</span>
                <Badge variant="outline" className={cn("shrink-0 border-transparent text-[11px]", VERDICT_CLASS[best])}>
                  {best === "unmapped" ? UNMAPPED_LABEL : VERDICT_LABEL[best]}
                </Badge>
              </button>
              {isOpen && <RequirementPanel requirement={r} rows={g} />}
            </div>
          );
        })}
        {rows.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</div>}
      </div>

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        이 페이지는 공유 링크로 열린 읽기 전용 화면입니다. 링크는 만든 사람이 언제든 폐기할 수 있습니다.
      </p>
    </main>
  );
}
