"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import NotebookManager from "@/components/guide/NotebookManager";
import SourceManager from "@/components/guide/SourceManager";
import type { NlmNotebook } from "@/types/guide";

interface AuthStatus {
  authenticated: boolean;
  storage_path?: string;
  storage_exists?: boolean;
}

export default function AdminGuidePage() {
  const [selectedNotebook, setSelectedNotebook] = useState<NlmNotebook | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    fetch("/api/guide/auth/status")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => data && setAuthStatus(data))
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, []);

  return (
    <>
      {/* NLM Auth Status Banner */}
      <div className="flex items-center gap-2 mb-6 p-3 rounded-lg border bg-muted/30">
        <span className="text-sm text-muted-foreground">NLM 서비스:</span>
        {authLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : authStatus?.authenticated ? (
          <Badge
            variant="default"
            className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          >
            <Wifi className="h-3 w-3 mr-1" />
            연결됨
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          >
            <WifiOff className="h-3 w-3 mr-1" />
            미연결
          </Badge>
        )}
        {authStatus?.authenticated && (
          <div className="flex items-center gap-2 ml-auto">
            <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
            <span className="text-xs text-muted-foreground">
              스토리지: {authStatus.storage_exists ? "확인됨" : "미확인"}
            </span>
          </div>
        )}
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <NotebookManager
            onSelectNotebook={setSelectedNotebook}
            selectedNotebookId={selectedNotebook?.id}
          />
        </div>
        <div>
          {selectedNotebook ? (
            <SourceManager notebook={selectedNotebook} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border rounded-lg border-dashed">
              <p className="text-sm">노트북을 선택하면 소스를 관리할 수 있습니다.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
