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
  Upload,
  Download,
} from "lucide-react";
import type { NlmNotebook } from "@/types/guide";

interface SourceItem {
  id: string;
  title: string;
  source_type: "file" | "url" | "text";
  is_ready?: boolean;
  has_file?: boolean;
  original_filename?: string;
}

interface SourceManagerProps {
  notebook: NlmNotebook;
  noDelete?: boolean;
}

const SOURCE_TYPE_CONFIG = {
  file: { icon: FileText, label: "파일", color: "text-blue-500" },
  url: { icon: Link, label: "URL", color: "text-green-500" },
  text: { icon: Type, label: "텍스트", color: "text-amber-500" },
} as const;

export default function SourceManager({ notebook, noDelete }: SourceManagerProps) {
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [addingFile, setAddingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [shutdownStatus, setShutdownStatus] = useState<string | null>(null);

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

  /** 소스 추가 완료 후 NLM 서비스 머신 자동 중지 */
  async function shutdownNlmService() {
    try {
      setShutdownStatus("NLM 서비스 종료 중...");
      const res = await fetch("/api/guide/nlm/shutdown", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setShutdownStatus(`NLM 서비스 종료 완료: ${data.message}`);
      } else {
        setShutdownStatus(`종료 실패: ${data.error}`);
      }
    } catch {
      setShutdownStatus("NLM 서비스 종료 요청 실패");
    }
    // 5초 후 상태 메시지 제거
    setTimeout(() => setShutdownStatus(null), 5000);
  }

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
      shutdownNlmService();
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
      shutdownNlmService();
    } catch (err) {
      alert(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setAddingUrl(false);
    }
  }

  async function handleAddFile() {
    if (selectedFiles.length === 0) return;
    setAddingFile(true);
    try {
      // 1. Supabase Storage에 업로드
      setUploadProgress(`파일 업로드 중... (0/${selectedFiles.length})`);
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append("file", file);
      }

      const uploadRes = await fetch(
        `/api/guide/notebooks/${notebook.id}/sources/upload`,
        { method: "POST", body: formData }
      );
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.error || "파일 업로드에 실패했습니다.");
      }
      const { files: uploaded } = await uploadRes.json();

      // 2. NLM 서비스에 각 파일을 소스로 추가
      for (let i = 0; i < uploaded.length; i++) {
        const { url, fileName, filePath } = uploaded[i];
        setUploadProgress(
          `NotebookLM에 소스 추가 중... (${i + 1}/${uploaded.length})`
        );
        const res = await fetch(`/api/guide/notebooks/${notebook.id}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "file",
            title: fileName,
            url,
            fileName,
            storagePath: filePath,
          }),
        });
        if (!res.ok) {
          throw new Error(`소스 추가 실패: ${fileName}`);
        }
      }

      setSelectedFiles([]);
      setUploadProgress("");
      setFileOpen(false);
      await fetchSources();
      shutdownNlmService();
    } catch (err) {
      alert(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setAddingFile(false);
      setUploadProgress("");
    }
  }

  async function handleDownload(sourceId: string) {
    try {
      const res = await fetch(
        `/api/guide/notebooks/${notebook.id}/sources/download?sourceId=${sourceId}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "다운로드에 실패했습니다.");
      }
      const { url } = await res.json();
      window.open(url, "_blank");
    } catch (err) {
      alert(err instanceof Error ? err.message : "다운로드에 실패했습니다.");
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
                    <Label htmlFor="src-file-input">파일 선택</Label>
                    <div
                      className="relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 hover:border-muted-foreground/50 transition-colors cursor-pointer"
                      onClick={() =>
                        document.getElementById("src-file-input")?.click()
                      }
                    >
                      <input
                        id="src-file-input"
                        type="file"
                        className="hidden"
                        multiple
                        accept=".pdf,.txt,.md,.docx,.xlsx"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          setSelectedFiles(files);
                        }}
                      />
                      {selectedFiles.length > 0 ? (
                        <div className="w-full space-y-1">
                          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                            {selectedFiles.map((file, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-sm">
                                <FileText className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                                <span className="truncate text-xs">{file.name}</span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {(file.size / 1024 / 1024).toFixed(1)}MB
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground text-center">
                            {selectedFiles.length}개 파일 선택됨 · 클릭하여 변경
                          </p>
                        </div>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 text-muted-foreground/50 mb-2" />
                          <p className="text-sm text-muted-foreground">
                            클릭하여 파일을 선택하세요
                          </p>
                          <p className="text-xs text-muted-foreground/75 mt-1">
                            PDF, TXT, MD, DOCX, XLSX (최대 50MB)
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={handleAddFile}
                    disabled={addingFile || selectedFiles.length === 0}
                    className="w-full"
                  >
                    {addingFile ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        {uploadProgress || "처리 중..."}
                      </>
                    ) : (
                      "업로드 및 추가"
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
        {shutdownStatus && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            {shutdownStatus}
          </div>
        )}
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
              const key = (source.source_type?.toLowerCase() ?? "text") as keyof typeof SOURCE_TYPE_CONFIG;
              const config = SOURCE_TYPE_CONFIG[key] ?? SOURCE_TYPE_CONFIG.text;
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

                  <div className="flex items-center gap-1 shrink-0">
                    {source.has_file && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-blue-500"
                        onClick={() => handleDownload(source.id)}
                        title={source.original_filename || "다운로드"}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    )}

                  {!noDelete && (
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
                  )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
