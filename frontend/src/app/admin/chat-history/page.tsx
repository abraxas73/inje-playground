"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Search,
  BookOpen,
  User,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import CitationsSection from "@/components/guide/CitationsSection";
import type { ChatMessage } from "@/types/guide";

interface PairedMessage {
  question: ChatMessage;
  answer: ChatMessage | null;
}

interface ChatHistoryResponse {
  items: PairedMessage[];
  notebooks: Record<string, string>;
  total: number;
  page: number;
  pageSize: number;
}

export default function AdminChatHistoryPage() {
  const [data, setData] = useState<ChatHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [notebookFilter, setNotebookFilter] = useState<string>("all");
  const [emailFilter, setEmailFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Expand state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Available notebooks (fetched once)
  const [allNotebooks, setAllNotebooks] = useState<
    { id: string; title: string }[]
  >([]);

  useEffect(() => {
    fetch("/api/guide/notebooks")
      .then((res) => res.json())
      .then((data) => {
        if (data.notebooks) setAllNotebooks(data.notebooks);
      })
      .catch(() => {});
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (notebookFilter && notebookFilter !== "all") {
        params.set("notebookId", notebookFilter);
      }
      if (emailFilter.trim()) {
        params.set("userEmail", emailFilter.trim());
      }

      const res = await fetch(`/api/admin/chat-history?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "조회에 실패했습니다.");
      }
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [page, notebookFilter, emailFilter]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  const handleSearch = () => {
    setPage(1);
    fetchHistory();
  };

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center bg-violet-100 text-violet-700">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div>
              <p className="text-2xl font-bold">{data?.total ?? "-"}</p>
              <p className="text-xs text-muted-foreground">총 질의 수</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center bg-emerald-100 text-emerald-700">
              <User className="h-4 w-4" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {data
                  ? new Set(data.items.map((i) => i.question.user_email)).size
                  : "-"}
              </p>
              <p className="text-xs text-muted-foreground">
                질의 사용자 (현재 페이지)
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center bg-amber-100 text-amber-700">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {data ? Object.keys(data.notebooks).length : "-"}
              </p>
              <p className="text-xs text-muted-foreground">사용된 노트북</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="py-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Select
              value={notebookFilter}
              onValueChange={(v) => {
                setNotebookFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[200px] h-9 text-sm">
                <SelectValue placeholder="노트북 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 노트북</SelectItem>
                {allNotebooks.map((nb) => (
                  <SelectItem key={nb.id} value={nb.id}>
                    {nb.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2 flex-1">
              <Input
                placeholder="이메일로 검색..."
                value={emailFilter}
                onChange={(e) => setEmailFilter(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="h-9 text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSearch}
                className="h-9 px-3"
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chat History List */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">질의/응답 목록</CardTitle>
            <Badge variant="secondary" className="text-xs ml-auto">
              {data?.total ?? 0}건
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="text-sm text-destructive mb-4">{error}</p>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                로딩 중...
              </span>
            </div>
          ) : data?.items.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              질의/응답 기록이 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {data?.items.map(({ question, answer }) => {
                const isExpanded = expandedIds.has(question.id);
                const notebookTitle =
                  data.notebooks[question.notebook_id] || "알 수 없음";
                return (
                  <div
                    key={question.id}
                    className="rounded-lg border hover:bg-muted/30 transition-colors"
                  >
                    {/* Question row */}
                    <button
                      onClick={() => toggleExpand(question.id)}
                      className="w-full text-left p-3 flex items-start gap-3"
                    >
                      <div className="shrink-0 mt-0.5">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium line-clamp-2">
                          {question.content}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <Badge
                            variant="outline"
                            className="text-[10px] h-5 gap-1 font-normal"
                          >
                            <User className="h-2.5 w-2.5" />
                            {question.user_email}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="text-[10px] h-5 gap-1 font-normal text-violet-700 border-violet-200 bg-violet-50"
                          >
                            <BookOpen className="h-2.5 w-2.5" />
                            {notebookTitle}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {new Date(question.created_at).toLocaleString(
                              "ko-KR",
                              {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </span>
                        </div>
                      </div>
                      {answer ? (
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-5 shrink-0 bg-emerald-50 text-emerald-700 border-emerald-200"
                        >
                          응답완료
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-5 shrink-0 bg-amber-50 text-amber-700 border-amber-200"
                        >
                          응답없음
                        </Badge>
                      )}
                    </button>

                    {/* Expanded answer */}
                    {isExpanded && answer && (
                      <div className="px-3 pb-3 pl-10">
                        <div className="rounded-lg bg-muted/50 p-3">
                          <p className="text-xs font-medium text-muted-foreground mb-1.5">
                            AI 응답
                          </p>
                          <div className="text-sm break-words leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-strong:text-foreground">
                            <ReactMarkdown>{answer.content}</ReactMarkdown>
                          </div>
                          {answer.citations && answer.citations.length > 0 && (
                            <CitationsSection citations={answer.citations} />
                          )}
                          <p className="text-[10px] text-muted-foreground/60 mt-2">
                            {new Date(answer.created_at).toLocaleString(
                              "ko-KR",
                              {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              }
                            )}
                          </p>
                        </div>
                      </div>
                    )}

                    {isExpanded && !answer && (
                      <div className="px-3 pb-3 pl-10">
                        <div className="rounded-lg bg-amber-50/50 p-3">
                          <p className="text-xs text-amber-600">
                            이 질의에 대한 응답이 기록되지 않았습니다.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <p className="text-xs text-muted-foreground">
                {data?.total ?? 0}건 중 {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, data?.total ?? 0)}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs px-2">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
