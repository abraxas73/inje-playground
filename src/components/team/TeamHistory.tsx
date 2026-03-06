"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { History, MessageSquare, Send, Loader2, ChevronDown, ChevronUp } from "lucide-react";

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
            <button
              onClick={() => setExpandedSession(isExpanded ? null : session.id)}
              className="w-full text-left"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base">
                      {session.title || dateStr}
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs">
                      {session.team_count}팀 / {session.participants.length}명
                    </Badge>
                    {session.card_holder_distribution && (
                      <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-800">
                        법카 균등분배
                      </Badge>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                {session.title && (
                  <p className="text-xs text-muted-foreground">{dateStr}</p>
                )}
              </CardHeader>
            </button>

            {isExpanded && (
              <CardContent className="pt-0">
                <Separator className="mb-4" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {session.team_results.map((team, index) => (
                    <TeamResultCard
                      key={team.id}
                      team={team}
                      index={index}
                      onCommentAdded={fetchSessions}
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

function TeamResultCard({
  team,
  index,
  onCommentAdded,
}: {
  team: TeamResult;
  index: number;
  onCommentAdded: () => void;
}) {
  const [commentText, setCommentText] = useState("");
  const [author, setAuthor] = useState("");
  const [sending, setSending] = useState(false);
  const [showComments, setShowComments] = useState(false);

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
      onCommentAdded();
    } catch {} finally {
      setSending(false);
    }
  };

  const commentCount = team.team_comments?.length || 0;

  return (
    <div className={`rounded-xl border p-3 ${TEAM_COLORS[index % TEAM_COLORS.length]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-white text-xs font-bold px-2 py-0.5 rounded ${TEAM_BADGE_COLORS[index % TEAM_BADGE_COLORS.length]}`}>
          {team.team_name}
        </span>
        <span className="text-xs text-muted-foreground">
          {team.members.length}명
        </span>
      </div>

      <ul className="space-y-1 mb-3">
        {team.members.map((member, mIndex) => (
          <li key={mIndex} className="text-sm flex items-center gap-1.5">
            {member.name}
            {member.hasCard && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-300 bg-amber-100 text-amber-800">
                법카
              </Badge>
            )}
          </li>
        ))}
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
            <div key={comment.id} className="text-xs bg-background/60 rounded-lg p-2">
              <span className="font-medium">{comment.author}</span>
              <span className="text-muted-foreground ml-1.5">
                {new Date(comment.created_at).toLocaleDateString("ko-KR", {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })}
              </span>
              <p className="mt-0.5">{comment.content}</p>
            </div>
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
