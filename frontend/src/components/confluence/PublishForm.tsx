"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { asProblem, confluenceFetch, ConnectNotice, type ApiProblem } from "./shared";

type Space = { key: string; name: string; type: string };
const LAST_SPACE = "confluence.lastSpace";
const LAST_PARENT = "confluence.lastParent.";
const read = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 동작 */ } };
/** 상위 페이지 — 페이지 주소(…/pages/123/…, ?pageId=123) 또는 숫자 id */
export function parentIdFrom(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  return /^\d{1,20}$/.test(t) ? t : (/\/pages\/(\d{1,20})(?:\/|$|\?)/.exec(t)?.[1] ?? /[?&]pageId=(\d{1,20})/.exec(t)?.[1] ?? null);
}

/** 공간·상위 페이지·제목·본문(마크다운)을 확인하고 본인 이름으로 Confluence 페이지를 만든다. kind별로 마지막 공간·상위 페이지를 기억한다. */
export default function PublishForm({ kind, title: initialTitle, markdown, onMarkdown }: { kind: string; title: string; markdown: string; onMarkdown: (v: string) => void }) {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [canWrite, setCanWrite] = useState(true);
  const [space, setSpace] = useState("");
  const [parent, setParent] = useState("");
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [made, setMade] = useState<{ title: string; url: string } | null>(null);
  useEffect(() => { const t = setTimeout(() => setTitle(initialTitle), 0); return () => clearTimeout(t); }, [initialTitle]);
  useEffect(() => {
    const t = setTimeout(async () => {
      setParent(read(LAST_PARENT + kind));
      try {
        const j = await confluenceFetch<{ spaces: Space[]; canWrite: boolean }>("/api/confluence/spaces");
        const list = [...j.spaces].sort((a, b) => Number(a.type === "personal") - Number(b.type === "personal") || a.name.localeCompare(b.name, "ko"));
        setSpaces(list); setCanWrite(j.canWrite);
        const last = read(LAST_SPACE);
        setSpace(list.some((s) => s.key === last) ? last : "");
      } catch (e) { setProblem(asProblem(e)); }
    }, 0);
    return () => clearTimeout(t);
  }, [kind]);

  if (problem && problem.kind !== "error") return <ConnectNotice problem={problem} />;
  if (!canWrite) return <ConnectNotice problem={{ kind: "scope", message: "Confluence에 페이지를 만들려면 설정에서 Atlassian 계정을 다시 연결해 쓰기 권한에 동의하세요." }} />;
  const parentId = parentIdFrom(parent);
  const parentBad = !!parent.trim() && !parentId;
  async function submit() {
    setBusy(true); setProblem(null); setMade(null);
    try {
      const r = await confluenceFetch<{ id: string; title: string; url: string }>("/api/confluence/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spaceKey: space, parentId, title, markdown }) });
      write(LAST_SPACE, space); write(LAST_PARENT + kind, parent.trim());
      setMade(r);
    } catch (e) { setProblem(asProblem(e)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="cf-space">공간</Label>
        <select id="cf-space" value={space} onChange={(e) => setSpace(e.target.value)} disabled={!spaces} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
          <option value="">{spaces ? "공간을 고르세요" : "불러오는 중…"}</option>
          {spaces?.map((s) => <option key={s.key} value={s.key}>{s.name}{s.type === "personal" ? " (개인)" : ""}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cf-parent">상위 페이지(선택)</Label>
        <Input id="cf-parent" value={parent} onChange={(e) => setParent(e.target.value)} placeholder="상위 페이지 주소 또는 번호 — 비우면 공간 최상위" aria-invalid={parentBad} />
        {parentBad && <p className="text-xs text-destructive">페이지 주소(…/pages/숫자/…) 또는 숫자를 넣으세요.</p>}
      </div>
    </div>
    <div className="space-y-1.5"><Label htmlFor="cf-title">제목</Label><Input id="cf-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} /></div>
    <div className="space-y-1.5">
      <Label htmlFor="cf-body">본문(마크다운 — # 제목, - 목록, 1. 번호, | 표 |, **굵게**)</Label>
      <Textarea id="cf-body" value={markdown} onChange={(e) => onMarkdown(e.target.value)} rows={18} className="font-mono text-sm" />
    </div>
    {problem && <p role="alert" className="text-sm text-destructive">{problem.message}</p>}
    {made && <p role="status" className="flex flex-wrap items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" />만들었습니다: <a href={made.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">{made.title}<ExternalLink className="h-3.5 w-3.5" /></a></p>}
    <Button onClick={() => void submit()} disabled={busy || !space || !title.trim() || !markdown.trim() || parentBad}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Confluence에 만들기</Button>
  </div>;
}
