"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ExcelPreview } from "@/lib/marketing/excel";
import { FIELDS, type Field, type SubmissionResult } from "@/lib/marketing/types";
import { api, errorMessage } from "./shared";
export default function ExcelUpload({ master, onClose, onSaved }: { master: boolean; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<ExcelPreview | null>(null); const [keys, setKeys] = useState<string[]>([]);
  const [results, setResults] = useState<Record<number, SubmissionResult>>({}); const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const succeeded = Object.values(results).filter(r => r.status === "submitted").length;
  const remaining = preview?.rows.filter((_, i) => results[i]?.status !== "submitted").length ?? 0;
  function close() { if (succeeded) onSaved(); else onClose(); }
  function edit(index: number, field: Field | "dbId", value: string) {
    setPreview(p => p && ({ ...p, rows: p.rows.map((r,i) => {
      if (i !== index) return r;
      const cellIssues = { ...r.cellIssues }; delete cellIssues[field];
      return { ...r, ...(field === "dbId" ? { dbId: value } : { data: { ...r.data, [field]: value } }), cellIssues, blockingErrors: Object.values(cellIssues) };
    }) }));
    setKeys(k => k.map((key,i) => i === index ? crypto.randomUUID() : key));
  }
  async function run(confirm: boolean) {
    if (!file) return; setBusy(true); setError("");
    try {
      if (confirm && !master && preview) {
        const blocked = Object.fromEntries(preview.rows.map((r,i) => [i, r] as const).filter(([i,r]) => results[i]?.status !== "submitted" && r.blockingErrors?.length).map(([i,r]) => [i, { index: i, row: r.row, status: "error" as const, error: r.blockingErrors!.join(" · ") }]));
        setResults(old => ({ ...old, ...blocked }));
        const indices = preview.rows.map((_,i) => i).filter(i => results[i]?.status !== "submitted" && !preview.rows[i].blockingErrors?.length);
        if (!indices.length) return;
        const response = await api<{ results: SubmissionResult[] }>("/api/marketing/submissions", { partial: true, rows: indices.map(i => { const r = preview.rows[i]; return { data: r.data, dbId: r.dbId, requestKey: keys[i], source: { file: preview.filename, hash: preview.hash, sheet: r.sheet, row: r.row, raw: r.raw } }; }) });
        setResults(old => ({ ...old, ...Object.fromEntries(response.results.map(r => [indices[r.index], r])) }));
        setEditing(null);
      } else {
        const body = new FormData(); body.set("file", file); if (confirm) { body.set("confirm", "true"); body.set("hash", preview!.hash); }
        const res = await fetch(`/api/marketing/excel?mode=${master ? "master" : "submit"}`, { method: "POST", body }); const json = await res.json(); if (!res.ok) throw new Error(json.error);
        if (confirm) onSaved(); else { setPreview(json); setResults({}); setEditing(null); setKeys(json.rows.map(() => crypto.randomUUID())); }
      }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={v => { if (!v && !busy) close(); }}><DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>{master ? "기존 Master DB 최초 이관" : "Excel Contact 제출"}</DialogTitle><DialogDescription>{master ? "기존 Master를 비어 있는 DB에 원본 그대로 보존합니다. 미리보기 확인 후 이관하세요." : "최대 50건. 누락·형식 오류도 확인 필요로 접수합니다. 읽을 수 없는 셀 등 접수 실패 행은 수정 후 다시 제출하세요."}</DialogDescription></DialogHeader>
    <Input aria-label="Excel 파일" type="file" accept=".xlsx" disabled={busy || succeeded > 0} onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResults({}); setError(""); }} />
    <Button variant="outline" disabled={!file || busy || succeeded > 0} onClick={() => run(false)}>{busy ? "처리 중…" : "파일 미리보기"}</Button>
    {preview && <div className="space-y-3"><p className="text-sm font-medium">{preview.sheet} · 헤더 {preview.headerRow}행 · 전체 {preview.total.toLocaleString()}건{master && " (처음 20건 미리보기)"}</p><details className="text-xs text-muted-foreground"><summary>인식된 컬럼</summary>{preview.columns.join(" · ")}</details>
      {!!preview.companyConflicts?.length && <div role="status" className="rounded border border-amber-200 p-3 text-sm"><p>동일 회사명·상이한 분류 {preview.companyConflicts.length}그룹. 이관 후 회사·기관 정비 목록에서 확인하세요.</p>{preview.companyConflicts.map(c => <p key={c.company}>{c.company} · {c.categories.join(" / ")} · {c.rows.join(", ")}행</p>)}</div>}
      {!!preview.errors.length && <p role="alert" className="text-destructive text-sm">{preview.errors.join(" / ")}</p>}
      {Object.keys(results).length > 0 && <p role="status" className="rounded bg-muted p-3 text-sm">제출 완료 {succeeded}건 · 미제출 {remaining}건. 완료된 행은 다시 제출하지 않습니다.</p>}
      <div className="max-h-72 overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-muted"><tr>{["행", "DB ID", "회사명", "성명", "이메일", "검사 / 결과", ""].map((t,i) => <th key={i} className="p-2 whitespace-nowrap">{t}</th>)}</tr></thead><tbody>{preview.rows.map((r,i) => <tr key={r.row} className="border-t"><td className="p-2">{r.row}</td><td className="p-2">{r.dbId || "신규"}</td><td className="p-2">{r.data.company || "미입력"}</td><td className="p-2">{r.data.name || "미입력"}</td><td className="p-2">{r.data.email}</td><td className="p-2">{results[i]?.status === "submitted" ? `접수 완료 · ${results[i].kind ?? "검수 대기"}${results[i].validationErrors?.length ? " · " + results[i].validationErrors!.join(", ") : ""}` : results[i]?.error || r.errors.join(", ") || (master ? "원본 보존" : "제출 시 기존 DB 비교")}</td><td>{!master && results[i]?.status !== "submitted" && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(i)}>{r.row}행 수정</Button>}</td></tr>)}</tbody></table></div>
      {editing !== null && <fieldset className="rounded border p-3"><legend>{preview.rows[editing].row}행 수정</legend><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">DB ID<Input value={preview.rows[editing].dbId} onChange={e => edit(editing,"dbId",e.target.value)} /></label>{(Object.keys(FIELDS) as Field[]).map(k => <label key={k} className="text-sm">{FIELDS[k]}<Input value={preview.rows[editing].data[k]} onChange={e => edit(editing,k,e.target.value)} /></label>)}</div></fieldset>}
      <div className="flex gap-2"><Button disabled={busy || !!preview.errors.length || (!master && remaining === 0)} onClick={() => run(true)}>{busy ? "검증·저장 중…" : master ? `${preview.total.toLocaleString()}건 이관 확정` : `${remaining}건 검증 후 제출`}</Button><Button variant="outline" disabled={busy} onClick={close}>{succeeded ? "완료 · 검수 목록으로" : "닫기"}</Button></div></div>}
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
  </DialogContent></Dialog>;
}
