"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2, ChevronDown, ChevronUp,
  Pencil, X, Trash2, Save, RefreshCw, Trophy, Skull,
} from "lucide-react";
import LadderCanvas from "./LadderCanvas";
import { rebuildLadder } from "@/lib/ladder";
import type { LadderData, LadderResult, LadderMapping } from "@/types/ladder";
import { logAction } from "@/lib/action-log";

interface LadderSession {
  id: string;
  title: string | null;
  participants: string[];
  results: LadderResult[];
  bridges: boolean[][];
  bridge_density: number;
  mappings: LadderMapping[];
  created_at: string;
}

export default function LadderHistory() {
  const [sessions, setSessions] = useState<LadderSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/ladder-sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleDelete = async (id: string) => {
    try {
      await fetch("/api/ladder-sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, delete: true }),
      });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      logAction("사다리 이력 삭제", "ladder", { sessionId: id });
    } catch {}
  };

  const handleUpdateTitle = async (id: string, title: string) => {
    try {
      await fetch("/api/ladder-sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      });
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: title || null } : s))
      );
      logAction("사다리 제목 수정", "ladder", { sessionId: id, title });
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        이력을 불러오는 중...
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        저장된 사다리 게임 이력이 없습니다
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {sessions.map((session) => {
        const isExpanded = expandedSession === session.id;
        const date = new Date(session.created_at);
        const dateStr = date.toLocaleDateString("ko-KR", {
          year: "numeric", month: "long", day: "numeric",
          hour: "2-digit", minute: "2-digit",
        });

        const rewardCount = session.results.filter((r) => r.type === "reward").length;
        const punishmentCount = session.results.filter((r) => r.type === "punishment").length;

        return (
          <Card key={session.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setExpandedSession(isExpanded ? null : session.id)}
                  className="flex items-center gap-2 md:gap-3 text-left flex-1 min-w-0 flex-wrap"
                >
                  <CardTitle className="text-base truncate">
                    {session.title || dateStr}
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {session.participants.length}명
                  </Badge>
                  {rewardCount > 0 && (
                    <Badge variant="outline" className="text-xs border-emerald-300 bg-emerald-50 text-emerald-800 shrink-0 gap-0.5">
                      <Trophy className="h-2.5 w-2.5" />{rewardCount}
                    </Badge>
                  )}
                  {punishmentCount > 0 && (
                    <Badge variant="outline" className="text-xs border-rose-300 bg-rose-50 text-rose-800 shrink-0 gap-0.5">
                      <Skull className="h-2.5 w-2.5" />{punishmentCount}
                    </Badge>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-destructive shrink-0 ml-2">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>이력을 삭제하시겠습니까?</AlertDialogTitle>
                      <AlertDialogDescription>
                        &quot;{session.title || dateStr}&quot; 이력이 삭제됩니다.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>취소</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(session.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        삭제
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              {session.title && (
                <p className="text-xs text-muted-foreground">{dateStr}</p>
              )}
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0">
                <Separator className="mb-4" />

                <SessionTitleEditor
                  sessionId={session.id}
                  currentTitle={session.title || ""}
                  onSave={handleUpdateTitle}
                />

                {/* Mappings summary */}
                {session.mappings.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3 mb-4">
                    {session.mappings.map((m, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className={`text-xs ${
                          m.result.type === "reward"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : m.result.type === "punishment"
                            ? "border-rose-300 bg-rose-50 text-rose-800"
                            : "border-gray-200"
                        }`}
                      >
                        {m.participant} → {m.result.text}
                      </Badge>
                    ))}
                  </div>
                )}

                <HistoryLadderView session={session} />
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function SessionTitleEditor({
  sessionId,
  currentTitle,
  onSave,
}: {
  sessionId: string;
  currentTitle: string;
  onSave: (id: string, title: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(currentTitle);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(sessionId, title.trim());
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setTitle(currentTitle);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">제목:</span>
        <span className="text-sm">{currentTitle || "(없음)"}</span>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing(true)}>
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">제목:</span>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목 입력"
        className="h-7 text-sm max-w-64"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSave();
          }
          if (e.key === "Escape") handleCancel();
        }}
        autoFocus
      />
      <Button size="sm" className="h-7 px-2" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleCancel}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function HistoryLadderView({ session }: { session: LadderSession }) {
  const [ladder, setLadder] = useState<LadderData | null>(null);
  const [key, setKey] = useState(0);

  // Auto-build ladder from saved data on mount
  useEffect(() => {
    const built = rebuildLadder(session.participants, session.results, session.bridges);
    setLadder(built);
  }, [session]);

  const handleRedraw = () => {
    // Re-generate with same participants/results but new bridges
    setLadder(null);
    setKey((k) => k + 1);
    setTimeout(() => {
      const built = rebuildLadder(session.participants, session.results, session.bridges);
      setLadder(built);
    }, 50);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleRedraw} className="text-xs">
          <RefreshCw className="h-3 w-3 mr-1" />
          다시 그리기
        </Button>
      </div>
      {ladder && (
        <LadderCanvas
          key={key}
          participants={session.participants}
          results={session.results}
          bridgeDensity={session.bridge_density}
          initialLadder={ladder}
          showControls={false}
        />
      )}
    </div>
  );
}
