"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ImportPreview, ImportResult } from "@/types/media-directory";

export default function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    if (!file) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/media-directory/import/preview", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "미리보기에 실패했습니다.");
      setPreview(body as ImportPreview);
    } catch (e) { setError(e instanceof Error ? e.message : "미리보기에 실패했습니다."); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/media-directory/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: preview.rows }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "적재에 실패했습니다.");
      setResult(body as ImportResult); setPreview(null); setFile(null); onImported();
    } catch (e) { setError(e instanceof Error ? e.message : "적재에 실패했습니다."); }
    finally { setBusy(false); }
  }
  function reset() { setFile(null); setPreview(null); setResult(null); setError(null); onClose(); }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>미디어 리스트 엑셀 업로드</DialogTitle>
        <DialogDescription>첫 시트의 ‘매체’·‘부서’ 열을 읽습니다. 부서가 빈 행은 그 매체를 ‘부서 무관’으로 표시합니다. 기존 항목은 유지되고 새 항목만 추가되므로 같은 파일을 다시 올려도 안전합니다. 2MB·2,000행 이하.</DialogDescription>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="media-xlsx">미디어 리스트 xlsx</Label><Input id="media-xlsx" type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); }} /></div>
          <Button variant="outline" disabled={!file || busy} onClick={loadPreview}>{busy && !preview && <Loader2 className="h-4 w-4 animate-spin" />}미리보기</Button>
          {preview && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{preview.filename} · 데이터 {preview.total}행{preview.blank > 0 && ` · 빈 행 ${preview.blank}`}</p>
              <p>신규 매체 {preview.newOutlets.length} · 신규 부서 {preview.newDepartments} · 이미 있음 {preview.existingPairs} · 중복 행 {preview.duplicates}</p>
              {preview.newOutlets.length > 0 && <p className="text-xs text-muted-foreground">신규 매체: {preview.newOutlets.slice(0, 30).join(", ")}{preview.newOutlets.length > 30 && " …"}</p>}
              {preview.anyDepartmentOutlets.length > 0 && <p className="text-xs text-muted-foreground">부서 무관으로 표시: {preview.anyDepartmentOutlets.slice(0, 30).join(", ")}{preview.anyDepartmentOutlets.length > 30 && " …"}</p>}
              {preview.invalid.length > 0 && <p className="text-xs text-destructive">건너뛰는 행 {preview.invalid.length}건: {preview.invalid.slice(0, 5).map((i) => `${i.row}행 ${i.reason}`).join(", ")}{preview.invalid.length > 5 && " …"}</p>}
              <Button disabled={busy || preview.rows.length === 0} onClick={apply}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{preview.rows.length}행 적용</Button>
            </div>
          )}
          {result && <p role="status" className="text-sm text-muted-foreground">매체 {result.outletsAdded}개, 부서 {result.departmentsAdded}개를 추가했습니다. 이미 있던 매체 {result.outletsExisting}·부서 {result.departmentsExisting}, 부서 무관 표시 {result.anyDepartmentSet}, 건너뜀 {result.skipped}.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
