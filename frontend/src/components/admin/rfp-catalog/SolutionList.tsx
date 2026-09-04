"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import EditableCell from "@/components/rfp/EditableCell";
import { cn } from "@/lib/utils";
import type { RfpAdminSolution } from "@/types/rfp";

async function readError(res: Response, fallback: string): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? fallback;
}

export default function SolutionList({ solutions, selected, onSelect, onChanged }: {
  solutions: RfpAdminSolution[]; selected: string | null; onSelect: (code: string) => void; onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rfp-catalog/solutions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim(), name: name.trim(), description: description.trim() }),
      });
      if (!res.ok) throw new Error(await readError(res, "추가에 실패했습니다."));
      const created = (await res.json()) as RfpAdminSolution;
      setAdding(false);
      setCode(""); setName(""); setDescription("");
      onChanged();
      onSelect(created.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">솔루션 <span className="font-normal text-muted-foreground">{solutions.length}</span></h2>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" />추가</Button>
      </div>
      <ul className="space-y-1">
        {solutions.map((s) => (
          <li key={s.code}>
            <button
              type="button"
              onClick={() => onSelect(s.code)}
              className={cn("w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40", selected === s.code && "border-primary bg-muted/60")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn("font-medium", !s.isActive && "text-muted-foreground line-through")}>{s.name}</span>
                {!s.isActive && <Badge variant="outline">비활성</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.code} · 기능 {s.featureCount}개(활성 {s.activeFeatureCount}) · 소스 {s.sourceCount}</div>
            </button>
          </li>
        ))}
        {!solutions.length && <li className="py-6 text-center text-sm text-muted-foreground">솔루션이 없습니다.</li>}
      </ul>

      <Dialog open={adding} onOpenChange={(o) => !o && !busy && setAdding(false)}>
        <DialogContent>
          <DialogHeader><DialogTitle>솔루션 추가</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>코드 <span className="text-xs text-muted-foreground">(소문자 영숫자·하이픈, 만든 뒤 변경 불가)</span></Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="secloudit" />
            </div>
            <div className="grid gap-1"><Label>이름</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="SECloudit" /></div>
            <div className="grid gap-1">
              <Label>설명 <span className="text-xs text-muted-foreground">(매핑 프롬프트에 그대로 들어갑니다)</span></Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setAdding(false)}>닫기</Button>
            <Button disabled={busy || !code.trim() || !name.trim()} onClick={submit}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 선택한 솔루션의 이름·설명 인라인 편집, 활성 토글, 삭제 */
export function SolutionHeader({ solution, onChanged, onDeleted }: { solution: RfpAdminSolution; onChanged: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await readError(res, "저장에 실패했습니다."));
    onChanged();
  };
  const remove = async () => {
    setError(null);
    const res = await fetch(`/api/admin/rfp-catalog/solutions/${solution.code}`, { method: "DELETE" });
    if (!res.ok) { setError(await readError(res, "삭제에 실패했습니다.")); return; }
    onDeleted();
  };
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-xs text-muted-foreground">{solution.code}</div>
          <EditableCell value={solution.name} onSave={(v) => patch({ name: v })} clampLines={0} className="text-lg font-semibold" />
          <EditableCell value={solution.description} onSave={(v) => patch({ description: v })} clampLines={3} placeholder="솔루션 설명(매핑 프롬프트에 사용) — 클릭해서 입력" />
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={solution.isActive} onCheckedChange={(v) => patch({ isActive: v }).catch((e) => setError(e instanceof Error ? e.message : "저장 실패"))} />
            {solution.isActive ? "활성" : "비활성"}
          </label>
          <AlertDialog>
            <Button variant="destructive" size="sm" asChild>
              <AlertDialogTrigger><Trash2 className="mr-1 h-4 w-4" />삭제</AlertDialogTrigger>
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{solution.name} 솔루션을 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>기능이나 매핑이 참조하는 솔루션은 삭제되지 않습니다. 그때는 비활성으로 바꾸세요.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {error && <div className="mt-2 text-sm text-destructive">{error}</div>}
    </div>
  );
}
