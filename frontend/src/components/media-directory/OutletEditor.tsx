"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { MediaDepartment, MediaOutlet } from "@/types/media-directory";

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "저장하지 못했습니다.");
  return result;
}

export default function OutletEditor({ outlet, onClose, onSaved }: { outlet: MediaOutlet | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(outlet?.name ?? "");
  const [aliases, setAliases] = useState(outlet?.aliases.join(", ") ?? "");
  const [anyDepartment, setAnyDepartment] = useState(outlet?.any_department ?? false);
  const [active, setActive] = useState(outlet?.active ?? true);
  const [departments, setDepartments] = useState<MediaDepartment[]>(outlet?.departments ?? []);
  const [newDepartment, setNewDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function saveOutlet() {
    setBusy(true); setMessage(null);
    try {
      await post("/api/media-directory/outlets", { id: outlet?.id ?? null, name: name.trim(), aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean), anyDepartment, active });
      onSaved();
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "저장하지 못했습니다.", error: true }); }
    finally { setBusy(false); }
  }
  async function saveDepartment(department: Partial<MediaDepartment> & { name: string }) {
    if (!outlet) return;
    setBusy(true); setMessage(null);
    try {
      const { department: saved } = await post("/api/media-directory/departments", { id: department.id ?? null, outletId: outlet.id, name: department.name.trim(), active: department.active ?? true });
      setDepartments((list) => (department.id ? list.map((d) => (d.id === saved.id ? saved : d)) : [...list, saved]));
      setNewDepartment(""); setMessage({ text: `부서 ‘${saved.name}’을 저장했습니다.`, error: false });
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "저장하지 못했습니다.", error: true }); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>{outlet ? "매체 수정" : "매체 추가"}</DialogTitle>
        <DialogDescription>매체명·별칭은 부고 기사 제목·요약에서 찾는 문자열입니다. 2자 이상, 다른 매체와 겹칠 수 없습니다.</DialogDescription>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="outlet-name">매체명</Label><Input id="outlet-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="outlet-aliases">별칭 (쉼표로 구분)</Label><Input id="outlet-aliases" value={aliases} placeholder="예: 헤럴드, ㈜헤럴드" onChange={(e) => setAliases(e.target.value)} /></div>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2"><Switch id="outlet-any" checked={anyDepartment} onCheckedChange={setAnyDepartment} /><Label htmlFor="outlet-any">부서 무관 (매체명만으로 일치)</Label></div>
            <div className="flex items-center gap-2"><Switch id="outlet-active" checked={active} onCheckedChange={setActive} /><Label htmlFor="outlet-active">활성</Label></div>
          </div>
          <Button onClick={saveOutlet} disabled={busy || name.trim().length < 2}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{outlet ? "매체 저장" : "매체 등록"}</Button>
          {outlet && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">부서</p>
              <ul className="space-y-2">
                {departments.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <Input aria-label={`부서명 ${d.name}`} defaultValue={d.name} maxLength={100} onBlur={(e) => { if (e.target.value.trim() !== d.name && e.target.value.trim().length >= 2) void saveDepartment({ ...d, name: e.target.value }); }} />
                    <Switch aria-label={`${d.name} 활성`} checked={d.active} disabled={busy} onCheckedChange={(checked) => void saveDepartment({ ...d, active: checked })} />
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2">
                <Label htmlFor="department-new" className="sr-only">부서 추가</Label>
                <Input id="department-new" placeholder="부서명 (예: 테크부)" value={newDepartment} maxLength={100} onChange={(e) => setNewDepartment(e.target.value)} />
                <Button variant="outline" disabled={busy || newDepartment.trim().length < 2} onClick={() => void saveDepartment({ name: newDepartment })}>부서 저장</Button>
              </div>
            </div>
          )}
          {message && <p role="status" className={`text-xs ${message.error ? "text-destructive" : "text-muted-foreground"}`}>{message.text}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
