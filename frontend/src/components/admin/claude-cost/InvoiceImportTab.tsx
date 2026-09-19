"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, Upload, Link2 } from "lucide-react";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { useCurrency } from "@/components/shared/currency-context";
import type { ClaudeOrg } from "@/types/claude-usage";
import type { InvoiceRow } from "@/types/claude-cost";

interface ImportResult { input: string; ok: boolean; invoice?: InvoiceRow; duplicate?: { invoice_number: string; issued_on: string; org_id: string | null }; errors?: string[] }
const UNASSIGNED = "__unassigned__";

/**
 * 인보이스 등록: 결제 메일의 Stripe 링크를 여러 줄 붙여 넣거나(주) PDF를 올린다(보조). 건별 결과를 그대로 보여주고,
 * 등록된 인보이스 표에서 Bill to 자동 매칭이 안 된 장을 조직에 배정하거나 삭제한다.
 */
export default function InvoiceImportTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const { fmt } = useCurrency();
  const [urls, setUrls] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  const reload = useCallback(() => {
    fetch("/api/admin/claude-cost/invoices")
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as { invoices: InvoiceRow[] }; })
      .then((j) => { setListError(null); setInvoices(j.invoices); })
      .catch((e) => setListError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const submit = async (body: FormData | { urls: string[] }) => {
    setBusy(true);
    setSubmitError(null);
    try {
      const r = await fetch("/api/admin/claude-cost/invoices", body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setResults((j as { results: ImportResult[] }).results);
      reload();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const submitUrls = () => {
    const list = urls.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) { setSubmitError("Stripe 인보이스 링크를 한 줄에 하나씩 붙여 넣으세요."); return; }
    void submit({ urls: list });
  };
  const submitFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    void submit(fd);
    if (fileRef.current) fileRef.current.value = "";
  };

  const assign = async (id: string, value: string) => {
    setRowError(null);
    const r = await fetch(`/api/admin/claude-cost/invoices/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: value === UNASSIGNED ? null : value }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setRowError((j as { error?: string }).error ?? `HTTP ${r.status}`); return; }
    reload();
  };
  const remove = async (inv: InvoiceRow) => {
    if (!window.confirm(`${inv.invoice_number} (${inv.bill_to}, ${fmt(inv.total_cents)}) 인보이스를 삭제할까요? 원본 PDF도 함께 지워집니다.`)) return;
    setRowError(null);
    const r = await fetch(`/api/admin/claude-cost/invoices/${inv.id}`, { method: "DELETE" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setRowError((j as { error?: string }).error ?? `HTTP ${r.status}`); return; }
    reload();
  };

  const columns: Column<InvoiceRow>[] = [
    { key: "issued", header: "발행일", value: (i) => i.issued_on },
    { key: "number", header: "번호", value: (i) => i.invoice_number, render: (i) => <span className="font-mono text-xs">{i.invoice_number}</span> },
    { key: "org", header: "조직", value: (i) => (i.org_id ? orgName.get(i.org_id) ?? i.org_id : ""), render: (i) => (
      <Select value={i.org_id ?? UNASSIGNED} onValueChange={(v) => assign(i.id, v)}>
        <SelectTrigger className={`h-7 w-[170px] text-xs ${i.org_id ? "" : "border-destructive text-destructive"}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>미배정</SelectItem>
          {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
        </SelectContent>
      </Select>) },
    { key: "billTo", header: "Bill to", value: (i) => i.bill_to },
    { key: "period", header: "서비스 기간", value: (i) => i.period_start ?? "", render: (i) => (i.period_start && i.period_end ? `${i.period_start} ~ ${i.period_end}` : "—") },
    { key: "plan", header: "티어", value: (i) => i.plan ?? "", render: (i) => i.plan ?? "—" },
    { key: "seats", header: "좌석", value: (i) => i.seats, align: "right" },
    { key: "subtotal", header: "세전", value: (i) => i.subtotal_cents / 100, align: "right", render: (i) => fmt(i.subtotal_cents) },
    { key: "tax", header: "VAT", value: (i) => i.tax_cents / 100, align: "right", render: (i) => fmt(i.tax_cents) },
    { key: "total", header: "총액", value: (i) => i.total_cents / 100, align: "right", className: "font-semibold", render: (i) => fmt(i.total_cents), total: (rows) => fmt(rows.reduce((a, r) => a + r.total_cents, 0)) },
    { key: "source", header: "원본", value: (i) => i.source, render: (i) => (
      <span className="inline-flex items-center gap-2 text-xs">
        <a className="underline" href={`/api/admin/claude-cost/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
        {i.source_url && <a className="underline text-muted-foreground" href={i.source_url} target="_blank" rel="noreferrer">Stripe</a>}
      </span>) },
    { key: "actions", header: "", value: () => "", render: (i) => <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => remove(i)} aria-label="삭제"><Trash2 className="h-3.5 w-3.5" /></Button> },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Link2 className="h-4 w-4" />Stripe 인보이스 링크로 등록</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">결제 메일의 &quot;View invoice&quot; 링크(<span className="font-mono">https://invoice.stripe.com/i/…</span>)를 한 줄에 하나씩. 7개 조직을 한 번에 붙여 넣어도 됩니다. 서버가 PDF를 받아 번호·조직(Bill to)·기간·좌석·금액을 읽고 합계를 검증합니다.</p>
          <Textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={4} placeholder={"https://invoice.stripe.com/i/acct_…/live_…?s=ap\nhttps://invoice.stripe.com/i/acct_…/live_…?s=ap"} className="font-mono text-xs" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={submitUrls} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}링크로 등록</Button>
            <span className="text-xs text-muted-foreground">또는</span>
            <Input ref={fileRef} type="file" accept="application/pdf" multiple className="h-8 w-[260px] text-xs" disabled={busy} onChange={(e) => submitFiles(e.target.files)} />
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Upload className="h-3.5 w-3.5" />PDF 직접 업로드(각 2MB)</span>
          </div>
          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          {results && (
            <ul className="space-y-1 text-xs">
              {results.map((r, i) => (
                <li key={i} className="flex flex-wrap items-start gap-2">
                  {r.ok ? <Badge>등록</Badge> : r.duplicate ? <Badge variant="outline">이미 등록됨</Badge> : <Badge variant="destructive">실패</Badge>}
                  <span className="font-mono break-all text-muted-foreground">{r.input.length > 70 ? `${r.input.slice(0, 70)}…` : r.input}</span>
                  {r.ok && r.invoice && <span>{r.invoice.invoice_number} · {r.invoice.bill_to} · {r.invoice.issued_on} · {fmt(r.invoice.total_cents)}{r.invoice.org_id ? "" : " · 조직 미배정"}</span>}
                  {r.duplicate && <span>{r.duplicate.invoice_number} ({r.duplicate.issued_on})</span>}
                  {r.errors && <span className="text-destructive">{r.errors.join(" / ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">등록된 인보이스 <Badge variant="outline">{invoices.length}장</Badge>{invoices.some((i) => !i.org_id) && <Badge variant="destructive">미배정 {invoices.filter((i) => !i.org_id).length}장 — 조직을 골라 주세요</Badge>}</div>
        {(listError || rowError) && <p className="text-sm text-destructive">{listError ?? rowError}</p>}
        <SortableTable rows={invoices} columns={columns} rowKey={(i) => i.id} defaultSort={{ key: "issued", dir: "desc" }} totalLabel={`총계 (${invoices.length}장)`} rowClassName={(i) => (i.org_id ? "" : "bg-destructive/5")} emptyText="등록된 인보이스가 없습니다." />
      </div>
    </div>
  );
}
