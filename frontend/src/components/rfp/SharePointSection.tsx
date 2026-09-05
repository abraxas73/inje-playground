"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudUpload, ExternalLink, FolderOpen, Link2, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { connectUrl } from "@/components/settings/MicrosoftAccountCard";
import { useMsCallbackQuery } from "@/hooks/useMsCallbackQuery";
import type { MsConnectionStatus } from "@/types/ms";
import type { RfpProjectDetail, SharepointErrorCode, SharepointFolder, SharepointResponse, UploadResponse } from "@/types/rfp";

interface Props {
  projectId: string;
  projectStatus: RfpProjectDetail["status"];
  /** 상세 GET의 sharepoint — 첫 렌더용. 마운트 뒤 GET …/sharepoint로 이력까지 다시 읽는다 */
  initial: RfpProjectDetail["sharepoint"];
}

type ApiError = { error?: string; code?: SharepointErrorCode };

const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR");

/** 프로젝트 상세: 폴더 지정 → 업로드 → 결과·이력(스펙 §8) */
export default function SharePointSection({ projectId, projectStatus, initial }: Props) {
  const [data, setData] = useState<SharepointResponse>({ folder: initial.folder, lastUpload: initial.lastUpload, uploads: initial.lastUpload ? [initial.lastUpload] : [] });
  const [conn, setConn] = useState<MsConnectionStatus | null>(null);
  const [reconnect, setReconnect] = useState(false);
  const [folderInput, setFolderInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"folder" | "unset" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);

  const base = `/api/rfp/projects/${projectId}/sharepoint`;

  const loadData = useCallback(async () => {
    const res = await fetch(base);
    if (!res.ok) return;
    setData((await res.json()) as SharepointResponse);
  }, [base]);

  const loadConn = useCallback(async () => {
    const res = await fetch("/api/ms/connection");
    setConn(res.ok ? ((await res.json()) as MsConnectionStatus) : { connected: false });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadData();
      void loadConn();
    }, 0);
    return () => clearTimeout(t);
  }, [loadData, loadConn]);

  useMsCallbackQuery({
    onConnected: () => {
      setNotice("Microsoft 계정이 연결되었습니다.");
      setReconnect(false);
      void loadConn();
    },
    onError: (message) => setError(message),
  });

  const connect = () => {
    window.location.assign(connectUrl(window.location.pathname));
  };

  /** 오류 응답을 화면 상태로: not_connected → 연결 버튼, reconnect → 재연결 버튼, 문구는 항상 표시 */
  const applyError = async (res: Response, fallback: string) => {
    const j = (await res.json().catch(() => ({}))) as ApiError;
    if (j.code === "not_connected") setConn({ connected: false });
    if (j.code === "reconnect") setReconnect(true);
    setError(j.error ?? fallback);
  };

  const setFolder = async () => {
    const url = folderInput.trim();
    if (!url) return;
    setBusy("folder");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${base}/folder`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      if (!res.ok) {
        await applyError(res, "폴더를 지정하지 못했습니다.");
        return;
      }
      const { folder } = (await res.json()) as { folder: SharepointFolder };
      setData((d) => ({ ...d, folder }));
      setFolderInput("");
      setEditing(false);
      setNotice(`폴더를 지정했습니다: ${folder.name}`);
    } finally {
      setBusy(null);
    }
  };

  const clearFolder = async () => {
    setBusy("unset");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${base}/folder`, { method: "DELETE" });
      if (!res.ok) {
        await applyError(res, "폴더를 해제하지 못했습니다.");
        return;
      }
      setData((d) => ({ ...d, folder: null }));
      setEditing(false);
    } finally {
      setBusy(null);
    }
  };

  const upload = async () => {
    setBusy("upload");
    setError(null);
    setNotice(null);
    setResult(null);
    try {
      const res = await fetch(`${base}/upload`, { method: "POST" });
      if (!res.ok) {
        await applyError(res, "업로드에 실패했습니다.");
        return;
      }
      setResult((await res.json()) as UploadResponse);
      setReconnect(false);
      await loadData();
    } finally {
      setBusy(null);
    }
  };

  const canUpload = !!data.folder && projectStatus === "ready" && busy === null;
  const uploadHint = !data.folder ? "먼저 SharePoint 폴더를 지정하세요." : projectStatus !== "ready" ? "요구사항 추출이 끝난 뒤 업로드할 수 있습니다." : undefined;
  const needsReconnect = reconnect || (conn?.connected === true && !!conn.lastError);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CloudUpload className="h-4 w-4" />
          SharePoint 등록
          {data.lastUpload && <span className="text-xs font-normal text-muted-foreground">마지막 업로드 {fmt(data.lastUpload.createdAt)}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}

        {/* 폴더 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 shrink-0 text-muted-foreground">폴더</span>
          {data.folder && !editing ? (
            <>
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{data.folder.name}</span>
              <Button size="sm" variant="link" className="h-auto p-0" asChild>
                <a href={data.folder.webUrl} target="_blank" rel="noreferrer">
                  폴더 열기
                  <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setFolderInput(data.folder?.url ?? ""); setEditing(true); }}>
                변경
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={busy !== null}>해제</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>폴더 지정을 해제할까요?</AlertDialogTitle>
                    <AlertDialogDescription>이미 올라간 파일과 업로드 이력은 그대로 남습니다. 다시 업로드하려면 폴더를 다시 지정해야 합니다.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction onClick={clearFolder}>해제</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <>
              <Input
                className="h-8 min-w-[280px] flex-1"
                placeholder="Teams/SharePoint 폴더의 '링크 복사' 값을 붙이세요"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void setFolder(); }}
                disabled={busy !== null}
              />
              <Button size="sm" disabled={busy !== null || !folderInput.trim()} onClick={setFolder}>
                {busy === "folder" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Link2 className="mr-1 h-4 w-4" />}
                폴더 지정
              </Button>
              {data.folder && (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(false)}>취소</Button>
              )}
            </>
          )}
        </div>

        {/* 업로드 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 shrink-0 text-muted-foreground">업로드</span>
          {conn === null ? (
            <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />연결 확인 중…</span>
          ) : !conn.connected ? (
            <>
              <span className="text-muted-foreground">업로드하려면 Microsoft 계정을 연결하세요.</span>
              <Button size="sm" variant="outline" onClick={connect}>
                <Link2 className="mr-1 h-4 w-4" />
                Microsoft 계정 연결
              </Button>
            </>
          ) : needsReconnect ? (
            <>
              <span className="text-destructive">연결이 만료되었습니다. 다시 연결하세요.</span>
              <Button size="sm" variant="outline" onClick={connect}>
                <RefreshCw className="mr-1 h-4 w-4" />
                다시 연결
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={!canUpload} title={uploadHint} onClick={upload}>
                {busy === "upload" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-1 h-4 w-4" />}
                SharePoint에 업로드
              </Button>
              <span className="text-xs text-muted-foreground">{conn.accountUpn ?? conn.accountName ?? ""} 계정으로 · 같은 날 파일은 덮어씁니다</span>
            </>
          )}
        </div>
        {result && (
          <Alert>
            <AlertDescription>
              업로드 완료 — <a className="underline" href={result.upload.webUrl} target="_blank" rel="noreferrer">{result.upload.fileName}</a>
              {" · "}
              {result.notified ? "Teams 알림 전송됨" : result.notifyError ? `알림 실패: ${result.notifyError}` : "Teams 알림 미설정(웹후크 없음)"}
            </AlertDescription>
          </Alert>
        )}

        {/* 최근 파일·이력 */}
        {data.lastUpload && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-muted-foreground">최근 파일</span>
            <a className="underline" href={data.lastUpload.webUrl} target="_blank" rel="noreferrer">{data.lastUpload.fileName}</a>
            <span className="text-xs text-muted-foreground">{fmt(data.lastUpload.createdAt)} · {data.lastUpload.uploadedBy.name ?? "—"}</span>
          </div>
        )}
        {data.uploads.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">이력 ({data.uploads.length}건)</summary>
            <ul className="mt-1 space-y-1">
              {data.uploads.map((u) => (
                <li key={u.id} className="flex flex-wrap gap-2">
                  <span className="text-muted-foreground">{fmt(u.createdAt)}</span>
                  <a className="underline" href={u.webUrl} target="_blank" rel="noreferrer">{u.fileName}</a>
                  <span className="text-muted-foreground">{u.uploadedBy.name ?? "—"} · {Math.round(u.sizeBytes / 1024)}KB</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
