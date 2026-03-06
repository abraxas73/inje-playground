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
  MessageSquare, Send, Loader2, ChevronDown, ChevronUp,
  Pencil, Check, X, Trash2, Save,
} from "lucide-react";
import { logAction } from "@/lib/action-log";

interface TeamComment {
  id: string;
  author: string;
  content: string;
  created_at: string;
}

interface TeamResult {
  id: string;
  team_name: string;
  members: { name: string; hasCard: boolean }[];
  attendance: Record<string, boolean> | null;
  team_comments: TeamComment[];
}

interface TeamSession {
  id: string;
  title: string | null;
  participants: string[];
  team_count: number;
  card_holder_distribution: boolean;
  created_at: string;
  team_results: TeamResult[];
}

const TEAM_COLORS = [
  "border-blue-200 bg-blue-50/50",
  "border-emerald-200 bg-emerald-50/50",
  "border-amber-200 bg-amber-50/50",
  "border-purple-200 bg-purple-50/50",
  "border-rose-200 bg-rose-50/50",
  "border-cyan-200 bg-cyan-50/50",
  "border-orange-200 bg-orange-50/50",
  "border-indigo-200 bg-indigo-50/50",
];

const TEAM_BADGE_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-purple-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-orange-600",
  "bg-indigo-600",
];

export default function TeamHistory() {
  const [sessions, setSessions] = useState<TeamSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/team-sessions");
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

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await fetch("/api/team-sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId, delete: true }),
      });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      logAction("팀 구성 이력 삭제", "team", { sessionId });
    } catch {}
  };

  const handleUpdateTitle = async (sessionId: string, title: string) => {
    try {
      await fetch("/api/team-sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId, title }),
      });
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: title || null } : s))
      );
      logAction("팀 구성 제목 수정", "team", { sessionId, title });
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
        저장된 팀 구성 이력이 없습니다
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

        return (
          <Card key={session.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setExpandedSession(isExpanded ? null : session.id)}
                  className="flex items-center gap-3 text-left flex-1 min-w-0"
                >
                  <CardTitle className="text-base truncate">
                    {session.title || dateStr}
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {session.team_count}팀 / {session.participants.length}명
                  </Badge>
                  {session.card_holder_distribution && (
                    <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-800 shrink-0">
                      법카 균등분배
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
                        이 작업은 목록에서 숨김 처리됩니다.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>취소</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDeleteSession(session.id)}
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

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                  {session.team_results.map((team, index) => (
                    <TeamResultCard
                      key={team.id}
                      team={team}
                      index={index}
                      onChanged={fetchSessions}
                    />
                  ))}
                </div>
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

function TeamResultCard({
  team,
  index,
  onChanged,
}: {
  team: TeamResult;
  index: number;
  onChanged: () => void;
}) {
  const [commentText, setCommentText] = useState("");
  const [author, setAuthor] = useState("");
  const [sending, setSending] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [localAttendance, setLocalAttendance] = useState<Record<string, boolean>>(team.attendance || {});

  const handleToggleAttendance = async (memberName: string) => {
    const current = localAttendance[memberName] ?? false;
    const next = !current;
    setLocalAttendance((prev) => ({ ...prev, [memberName]: next }));
    try {
      await fetch("/api/team-attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamResultId: team.id,
          memberName,
          attended: next,
        }),
      });
      logAction("참석 여부 변경", "team", { memberName, attended: next });
    } catch {
      setLocalAttendance((prev) => ({ ...prev, [memberName]: current }));
    }
  };

  const handleSubmit = async () => {
    if (!commentText.trim()) return;
    setSending(true);
    try {
      await fetch("/api/team-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamResultId: team.id,
          author: author.trim() || "익명",
          content: commentText.trim(),
        }),
      });
      setCommentText("");
      onChanged();
      logAction("팀 코멘트 추가", "team", { teamName: team.team_name });
    } catch {} finally {
      setSending(false);
    }
  };

  const commentCount = team.team_comments?.length || 0;
  const attendedCount = team.members.filter((m) => localAttendance[m.name]).length;

  return (
    <div className={`rounded-xl border p-3 ${TEAM_COLORS[index % TEAM_COLORS.length]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-white text-xs font-bold px-2 py-0.5 rounded ${TEAM_BADGE_COLORS[index % TEAM_BADGE_COLORS.length]}`}>
          {team.team_name}
        </span>
        <span className="text-xs text-muted-foreground">
          {attendedCount}/{team.members.length}명 참석
        </span>
      </div>

      <ul className="space-y-1 mb-3">
        {team.members.map((member, mIndex) => {
          const attended = localAttendance[member.name] ?? false;
          return (
            <li key={mIndex} className="text-sm flex items-center gap-1.5">
              <button
                onClick={() => handleToggleAttendance(member.name)}
                className={`text-[10px] px-1.5 py-0 rounded-full border cursor-pointer transition-colors ${
                  attended
                    ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                    : "border-gray-300 bg-gray-50 text-gray-400"
                }`}
                title={attended ? "참석 취소" : "참석 체크"}
              >
                {attended ? "참석" : "미정"}
              </button>
              <span className={attended ? "" : "text-muted-foreground"}>{member.name}</span>
              {member.hasCard && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-300 bg-amber-100 text-amber-800">
                  법카
                </Badge>
              )}
            </li>
          );
        })}
      </ul>

      <button
        onClick={() => setShowComments(!showComments)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageSquare className="h-3 w-3" />
        코멘트 {commentCount > 0 && `(${commentCount})`}
      </button>

      {showComments && (
        <div className="mt-2 space-y-2">
          {team.team_comments?.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              onChanged={onChanged}
            />
          ))}

          <div className="flex gap-1.5">
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="이름"
              className="w-16 h-7 text-xs"
            />
            <Input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="코멘트 입력..."
              className="flex-1 h-7 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={sending || !commentText.trim()}
              className="h-7 px-2"
            >
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  onChanged,
}: {
  comment: TeamComment;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/team-comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: comment.id, content: editText.trim() }),
      });
      onChanged();
      setEditing(false);
    } catch {} finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await fetch("/api/team-comments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: comment.id }),
      });
      onChanged();
    } catch {}
  };

  const handleCancel = () => {
    setEditText(comment.content);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="text-xs bg-background/60 rounded-lg p-2 space-y-1.5">
        <Input
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="h-6 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSave();
            }
            if (e.key === "Escape") handleCancel();
          }}
          autoFocus
        />
        <div className="flex gap-1">
          <Button size="sm" className="h-5 px-1.5 text-[10px]" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={handleCancel}>
            <X className="h-2.5 w-2.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-xs bg-background/60 rounded-lg p-2 group">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{comment.author}</span>
          <span className="text-muted-foreground ml-1.5">
            {new Date(comment.created_at).toLocaleDateString("ko-KR", {
              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            })}
          </span>
        </div>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            className="p-0.5 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-2.5 w-2.5" />
          </button>
          <button
            onClick={handleDelete}
            className="p-0.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
      <p className="mt-0.5">{comment.content}</p>
    </div>
  );
}
