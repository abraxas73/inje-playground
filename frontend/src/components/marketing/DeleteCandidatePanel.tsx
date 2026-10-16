"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Contact } from "@/lib/marketing/types";
import { api, date, errorMessage } from "./shared";

/** 최신 Master 파일에 없어 삭제 후보로 표시된 Contact — 검수자가 후보 해제 또는 삭제를 결정한다. */
export default function DeleteCandidatePanel({ contact, reviewer, onDone }: { contact: Contact; reviewer: boolean; onDone: (message: string) => void }) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const candidate = contact.delete_candidate;
  if (!candidate) return null;
  async function resolve(decision: "keep" | "delete") {
    setBusy(true); setError("");
    try {
      await api("/api/marketing/review", { action: "delete-candidate", id: contact.id, version: contact.version, decision, reason });
      onDone(decision === "keep" ? "삭제 후보를 해제했습니다." : `${contact.db_id}를 삭제했습니다.`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
    <p className="font-medium text-destructive">삭제 후보</p>
    <p>{candidate.reason} · {date(candidate.at)}</p>
    {reviewer && <>
      <Input aria-label="처리 사유" placeholder="처리 사유 (2자 이상)" value={reason} maxLength={2000} disabled={busy} onChange={e => setReason(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy || reason.trim().length < 2} onClick={() => void resolve("keep")}>후보 해제(유지)</Button>
        <Button variant="destructive" size="sm" disabled={busy || reason.trim().length < 2} onClick={() => void resolve("delete")}>삭제</Button>
      </div>
    </>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </section>;
}
