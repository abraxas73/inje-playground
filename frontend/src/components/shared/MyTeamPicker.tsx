"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Loader2, Search, UserPlus, Users } from "lucide-react";
import type { MemberSourceProvider } from "@/lib/providers";
import type { Member } from "@/lib/members/types";
import { createAppUsersMemberSource } from "@/lib/members/users";
import { createTeamsMemberSource } from "@/lib/members/teams";
import {
  memberKey,
  splitCurrent,
  isValidEmail,
  mergeManual,
  toDrafts,
  type TeamMemberDraft,
} from "@/lib/my-team";
import type { UserMember } from "@/hooks/useUserMembers";

interface MyTeamPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 멤버 소스 provider (users | teams). dooray는 이 모달을 쓰지 않는다 */
  provider: MemberSourceProvider;
  /** 현재 저장된 내 팀(user_members) — 미리 체크 */
  current: UserMember[];
  /** 저장: 선택된 소스 구성원 + 직접 추가 구성원(기존 목록 교체) */
  onSave: (drafts: TeamMemberDraft[]) => Promise<void> | void;
}

/** 직접 추가 항목의 선택 키 (소스 id와 충돌하지 않도록 접두) */
function extraKey(e: { name: string; email?: string | null }): string {
  return `extra:${memberKey(e)}`;
}

const SOURCE_LABEL: Record<MemberSourceProvider, string> = {
  users: "앱 사용자 명단",
  teams: "Teams 구성원",
  dooray: "Dooray",
};

export default function MyTeamPicker({ open, onOpenChange, provider, current, onSave }: MyTeamPickerProps) {
  const [source, setSource] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<TeamMemberDraft[]>([]);
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // current 배열 identity가 아니라 내용으로 effect 트리거
  const currentKey = current.map(memberKey).join("|");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setSearch("");
    setManualName("");
    setManualEmail("");
    setManualError(null);

    (async () => {
      setLoading(true);
      try {
        const src =
          provider === "dooray"
            ? []
            : await (provider === "users" ? createAppUsersMemberSource() : createTeamsMemberSource()).listMembers();
        if (cancelled) return;
        setSource(src);
        const { preselected, extras: keep } = splitCurrent(current, src);
        setExtras(keep);
        // 선택 키: 소스 항목은 고유 id(동명이인 안전), 직접 추가 항목은 "extra:"+memberKey
        const ids = src.filter((s) => preselected.has(memberKey(s))).map((s) => s.id);
        setSelected(new Set([...ids, ...keep.map(extraKey)]));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "구성원을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider, currentKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((m) => m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q));
  }, [source, search]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allVisibleSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id));
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((m) => next.delete(m.id));
      else filtered.forEach((m) => next.add(m.id));
      return next;
    });
  };

  const addManual = () => {
    const name = manualName.trim();
    const email = manualEmail.trim();
    if (!name) {
      setManualError("이름을 입력하세요.");
      return;
    }
    if (email && !isValidEmail(email)) {
      setManualError("이메일 형식이 올바르지 않습니다.");
      return;
    }
    setManualError(null);
    const key = memberKey({ name, email });
    const inSource = source.find((m) => memberKey(m) === key);
    if (inSource) {
      setSelected((prev) => new Set(prev).add(inSource.id)); // 소스에 있는 사람이면 그 항목을 선택
    } else {
      setExtras((prev) => mergeManual(prev, { name, email }));
      setSelected((prev) => new Set(prev).add(extraKey({ name, email })));
    }
    setManualName("");
    setManualEmail("");
  };

  const selectedCount = selected.size;

  const handleSave = async () => {
    const drafts: TeamMemberDraft[] = [
      ...toDrafts(source.filter((m) => selected.has(m.id))),
      ...extras.filter((e) => selected.has(extraKey(e))),
    ];
    if (!drafts.length) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(drafts);
      onOpenChange(false); // 성공했을 때만 닫는다
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            내 팀 구성원 선택
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {SOURCE_LABEL[provider]}에서 내 팀을 고르세요. 여기서 저장한 명단이 사다리·팀 나누기·점심의 기본 구성원이 됩니다.
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            구성원 불러오는 중...
          </div>
        ) : (
          <div className="space-y-3">
            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="이름·이메일 검색..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{selectedCount}명 선택</span>
              {filtered.length > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleAllVisible}>
                  {allVisibleSelected ? "표시된 항목 해제" : "표시된 항목 전체 선택"}
                </Button>
              )}
            </div>

            <div className="max-h-[40vh] overflow-y-auto space-y-1">
              {filtered.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(m.id)} />
                    <span className="text-sm">{m.name}</span>
                    {m.email && <span className="text-xs text-muted-foreground truncate">{m.email}</span>}
                  </label>
              ))}
              {!error && filtered.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {source.length === 0 ? "불러올 구성원이 없습니다. 아래에서 직접 추가할 수 있습니다." : "검색 결과가 없습니다."}
                </p>
              )}

              {extras.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground pt-2">직접 추가한 구성원</p>
                  {extras.map((e) => {
                    const key = extraKey(e);
                    return (
                      <label
                        key={key}
                        className="flex items-center gap-3 p-2 rounded-lg border border-dashed hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <Checkbox checked={selected.has(key)} onCheckedChange={() => toggle(key)} />
                        <span className="text-sm">{e.name}</span>
                        {e.email && <span className="text-xs text-muted-foreground truncate">{e.email}</span>}
                      </label>
                    );
                  })}
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">명단에 없는 사람은 직접 추가 (이메일이 있어야 Teams DM을 받습니다)</p>
              <div className="flex gap-1.5">
                <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="이름" className="h-9" />
                <Input
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="이메일(선택)"
                  className="h-9"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addManual();
                    }
                  }}
                />
                <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={addManual}>
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                  추가
                </Button>
              </div>
              {manualError && <p className="text-xs text-destructive">{manualError}</p>}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
                취소
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || selectedCount === 0}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                저장 ({selectedCount}명)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
