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
  FileText,
  Link,
  Type,
  Database,
} from "lucide-react";
import type { NlmNotebook } from "@/types/guide";

interface SourceItem {
  id: string;
  title: string;
  source_type: "file" | "url" | "text";
  is_ready?: boolean;
}

interface SourceManagerProps {
  notebook: NlmNotebook;
}

const SOURCE_TYPE_CONFIG = {
  file: { icon: FileText, label: "파일", color: "text-blue-500" },
  url: { icon: Link, label: "URL", color: "text-green-500" },
  text: { icon: Type, label: "텍스트", color: "text-amber-500" },
} as const;

export default function SourceManager({ notebook }: SourceManagerProps) {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Text source dialog
  const [textOpen, setTextOpen] = useState(false);
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [addingText, setAddingText] = useState(false);

  // URL source dialog
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);

  // File source dialog
  const [fileOpen, setFileOpen] = useState(false);
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [addingFile, setAddingFile] = useState(false);

  const fetchSources = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch(`/api/guide/notebooks/${notebook.id}/sources`);
      if (!res.ok) throw new Error("소스 목록을 불러올 수 없습니다.");
      const data = await res.json();
      setSources(data.sources ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [notebook.id]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  async function handleAddText() {
    if (!textTitle.trim() || !textContent.trim()) return;
    setAddingText(true);
    try {
      const res = await fetch(`/api/guide/notebooks/${notebook.id}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "text",
          title: textTitle.trim(),
          content: textContent.trim(),
        }),
      });
      if (!res.ok) throw new Error("텍스트 소스 추가에 실패했습니다.");
      setTextTitle("");
      setTextContent("");
      setTextOpen(false);
      await fetchSources();
    } catch (err) {
      alert(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setAddingText(false);
    }
  }

  async function handleAddUrl() {
    if (!urlValue.trim()) return;
    setAddingUrl(true);
    try {
      const res = await fetch(`/api/guide/notebooks/${notebook.id}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "url",
          title: urlTitle.trim() || undefined,
          url: urlValue.trim(),
        }),
      });
      if (!res.ok) throw new Error("URL 소스 추가에 실패했습니다.");
      setUrlValue("");
      setUrlTitle("");
      setUrlOpen(false);
      await fetchSources();
    } catch (err) {
      alert(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setAddingUrl(false);
    }
  }

  async function handleAddFile() {
    if (!fileUrl.trim() || !fileName.trim()) return;
    setAddingFile(true);
    try {
      const res = await fetch(`/api/guide/notebooks/${notebook.id}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "file",
          title: fileName.trim(),
          url: fileUrl.trim(),
          fileName: fileName.trim(),
        }),
      });
      if (!res.ok) throw new Error("파일 소스 추가에 실패했습니다.");
      setFileUrl("");
      setFileName("");
      setFileOpen(false);
      await fetchSources();
    } catch (err) {
      alert(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setAddingFile(false);
    }
  }

  async function handleDelete(sourceId: string) {
    try {
      const res = await fetch(
        `/api/guide/notebooks/${notebook.id}/sources?sourceId=${sourceId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("소스 삭제에 실패했습니다.");
      await fetchSources();
    } catch (err) {
      alert(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-violet-500" />
            <CardTitle className="text-base">소스 관리</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Dialog open={textOpen} onOpenChange={setTextOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  텍스트
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>텍스트 소스 추가</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="src-text-title">제목</Label>
                    <Input
                      id="src-text-title"
                      value={textTitle}
                      onChange={(e) => setTextTitle(e.target.value)}
                      placeholder="소스 제목"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="src-text-content">내용</Label>
                    <Textarea
                      id="src-text-content"
                      value={textContent}
                      onChange={(e) => setTextContent(e.target.value)}
                      placeholder="텍스트 내용을 입력하세요..."
                      rows={8}
                    />
                  </div>
                  <Button
                    onClick={handleAddText}
                    disabled={addingText || !textTitle.trim() || !textContent.trim()}
                    className="w-full"
                  >
                    {addingText ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        추가 중...
                      </>
                    ) : (
                      "추가"
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  URL
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>URL 소스 추가</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="src-url-title">제목 (선택)</Label>
                    <Input
                      id="src-url-title"
                      value={urlTitle}
                      onChange={(e) => setUrlTitle(e.target.value)}
                      placeholder="소스 제목"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="src-url-value">URL</Label>
                    <Input
                      id="src-url-value"
                      type="url"
                      value={urlValue}
                      onChange={(e) => setUrlValue(e.target.value)}
                      placeholder="https://..."
                    />
                  </div>
                  <Button
                    onClick={handleAddUrl}
                    disabled={addingUrl || !urlValue.trim()}
                    className="w-full"
                  >
                    {addingUrl ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        추가 중...
                      </>
                    ) : (
                      "추가"
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={fileOpen} onOpenChange={setFileOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  파일
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>파일 소스 추가</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="src-file-name">파일명</Label>
                    <Input
                      id="src-file-name"
                      value={fileName}
                      onChange={(e) => setFileName(e.target.value)}
                      placeholder="document.pdf"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="src-file-url">파일 URL</Label>
                    <Input
                      id="src-file-url"
                      type="url"
                      value={fileUrl}
                      onChange={(e) => setFileUrl(e.target.value)}
                      placeholder="https://storage.example.com/file.pdf"
                    />
                    <p className="text-xs text-muted-foreground">
                      접근 가능한 파일 URL을 입력하세요.
                    </p>
                  </div>
                  <Button
                    onClick={handleAddFile}
                    disabled={addingFile || !fileUrl.trim() || !fileName.trim()}
                    className="w-full"
                  >
                    {addingFile ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        추가 중...
                      </>
                    ) : (
                      "추가"
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <CardDescription>
          {notebook.title} — {sources.length}개의 소스
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive mb-4">{error}</p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
            <span className="ml-2 text-sm text-muted-foreground">
              소스 로딩 중...
            </span>
          </div>
        ) : sources.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            등록된 소스가 없습니다. 위 버튼으로 소스를 추가하세요.
          </p>
        ) : (
          <div className="space-y-2">
            {sources.map((source) => {
              const config = SOURCE_TYPE_CONFIG[source.source_type];
              const Icon = config.icon;

              return (
                <div
                  key={source.id}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">
                        {source.title}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-xs">
                          {config.label}
                        </Badge>
                        {source.is_ready !== undefined && (
                          <Badge
                            variant={source.is_ready ? "default" : "outline"}
                            className="text-xs"
                          >
                            {source.is_ready ? "준비됨" : "처리 중"}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>소스 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                          &quot;{source.title}&quot; 소스를 삭제하시겠습니까?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(source.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          삭제
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
