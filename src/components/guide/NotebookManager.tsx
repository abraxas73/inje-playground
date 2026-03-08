"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Loader2,
  Plus,
  Trash2,
  BookOpen,
  Eye,
  EyeOff,
} from "lucide-react";
import type { NlmNotebook } from "@/types/guide";

interface NotebookManagerProps {
  onSelectNotebook: (notebook: NlmNotebook) => void;
  selectedNotebookId?: string;
}

export default function NotebookManager({
  onSelectNotebook,
  selectedNotebookId,
}: NotebookManagerProps) {
  const [notebooks, setNotebooks] = useState<NlmNotebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Sort order editing
  const [editingSortId, setEditingSortId] = useState<string | null>(null);
  const [editingSortValue, setEditingSortValue] = useState("");

  const fetchNotebooks = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/guide/notebooks");
      if (!res.ok) throw new Error("노트북 목록을 불러올 수 없습니다.");
      const data = await res.json();
      setNotebooks(data.notebooks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotebooks();
  }, [fetchNotebooks]);

  async function handleCreate() {
    if (!createTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/guide/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createTitle.trim(),
          description: createDescription.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("노트북 생성에 실패했습니다.");
      setCreateTitle("");
      setCreateDescription("");
      setCreateOpen(false);
      await fetchNotebooks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/guide/notebooks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("노트북 삭제에 실패했습니다.");
      if (selectedNotebookId === id) {
        // Deselect if deleted
        const remaining = notebooks.filter((n) => n.id !== id);
        if (remaining.length > 0) {
          onSelectNotebook(remaining[0]);
        }
      }
      await fetchNotebooks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  }

  async function handleToggleVisibility(notebook: NlmNotebook) {
    try {
      const res = await fetch(`/api/guide/notebooks/${notebook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_visible: !notebook.is_visible }),
      });
      if (!res.ok) throw new Error("노출 상태 변경에 실패했습니다.");
      await fetchNotebooks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  }

  async function handleSortOrderChange(notebookId: string, newOrder: number) {
    try {
      const res = await fetch(`/api/guide/notebooks/${notebookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: newOrder }),
      });
      if (!res.ok) throw new Error("정렬 순서 변경에 실패했습니다.");
      setEditingSortId(null);
      await fetchNotebooks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
          <span className="ml-2 text-sm text-muted-foreground">
            노트북 목록 로딩 중...
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-violet-500" />
            <CardTitle className="text-base">노트북 관리</CardTitle>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1" />
                노트북 생성
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>새 노트북 생성</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="nb-title">제목</Label>
                  <Input
                    id="nb-title"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    placeholder="노트북 제목"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nb-desc">설명 (선택)</Label>
                  <Textarea
                    id="nb-desc"
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    placeholder="노트북에 대한 간단한 설명"
                    rows={3}
                  />
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={creating || !createTitle.trim()}
                  className="w-full"
                >
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      생성 중...
                    </>
                  ) : (
                    "생성"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <CardDescription>
          {notebooks.length}개의 노트북
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive mb-4">{error}</p>
        )}

        {notebooks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            등록된 노트북이 없습니다.
          </p>
        ) : (
          <div className="space-y-3">
            {notebooks.map((nb) => (
              <div
                key={nb.id}
                className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                  selectedNotebookId === nb.id
                    ? "border-violet-500 bg-violet-50 dark:bg-violet-950/20"
                    : "hover:border-violet-300 hover:bg-muted/50"
                }`}
                onClick={() => onSelectNotebook(nb)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {nb.title}
                      </span>
                      <Badge
                        variant={nb.is_visible ? "default" : "secondary"}
                        className="text-xs shrink-0"
                      >
                        {nb.is_visible ? "노출" : "숨김"}
                      </Badge>
                    </div>
                    {nb.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {nb.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>노트북 삭제</AlertDialogTitle>
                          <AlertDialogDescription>
                            &quot;{nb.title}&quot; 노트북을 삭제하시겠습니까?
                            <br />
                            포함된 소스와 대화 기록도 함께 삭제됩니다.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>취소</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(nb.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            삭제
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-2 pt-2 border-t">
                  <div
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      {nb.is_visible ? (
                        <Eye className="h-3 w-3" />
                      ) : (
                        <EyeOff className="h-3 w-3" />
                      )}
                      노출
                    </span>
                    <Switch
                      checked={nb.is_visible}
                      onCheckedChange={() => handleToggleVisibility(nb)}
                    />
                  </div>

                  <div
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-xs text-muted-foreground">순서</span>
                    {editingSortId === nb.id ? (
                      <Input
                        type="number"
                        value={editingSortValue}
                        onChange={(e) => setEditingSortValue(e.target.value)}
                        onBlur={() => {
                          const val = parseInt(editingSortValue, 10);
                          if (!isNaN(val) && val !== nb.sort_order) {
                            handleSortOrderChange(nb.id, val);
                          } else {
                            setEditingSortId(null);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const val = parseInt(editingSortValue, 10);
                            if (!isNaN(val)) {
                              handleSortOrderChange(nb.id, val);
                            }
                          } else if (e.key === "Escape") {
                            setEditingSortId(null);
                          }
                        }}
                        className="h-6 w-14 text-xs"
                        autoFocus
                      />
                    ) : (
                      <button
                        className="text-xs font-mono bg-muted rounded px-1.5 py-0.5 hover:bg-muted/80"
                        onClick={() => {
                          setEditingSortId(nb.id);
                          setEditingSortValue(String(nb.sort_order));
                        }}
                      >
                        {nb.sort_order}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
