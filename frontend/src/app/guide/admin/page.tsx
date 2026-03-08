"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert, ShieldCheck, Wifi, WifiOff, Settings } from "lucide-react";
import NotebookManager from "@/components/guide/NotebookManager";
import SourceManager from "@/components/guide/SourceManager";
import type { NlmNotebook } from "@/types/guide";

const SUPER_USER = "abraxas73@gmail.com";

interface AuthStatus {
  authenticated: boolean;
  storage_path?: string;
  storage_exists?: boolean;
}

export default function GuideAdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [selectedNotebook, setSelectedNotebook] = useState<NlmNotebook | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Check super user authorization
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const isSuper = data.user?.email === SUPER_USER;
      setAuthorized(isSuper);
      if (!isSuper) {
        router.replace("/guide");
      }
    });
  }, [router]);

  // Fetch NLM auth status
  useEffect(() => {
    if (authorized !== true) return;
    async function fetchAuthStatus() {
      try {
        const res = await fetch("/api/guide/auth/status");
        if (res.ok) {
          const data = await res.json();
          setAuthStatus(data);
        }
      } catch {
        // Silently fail — status badge will show disconnected
      } finally {
        setAuthLoading(false);
      }
    }
    fetchAuthStatus();
  }, [authorized]);

  if (authorized === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        권한 확인 중...
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p className="text-sm">접근 권한이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-xl bg-violet-100 flex items-center justify-center">
          <Settings className="h-5 w-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">가이드 관리</h1>
          <p className="text-sm text-muted-foreground">
            노트북과 소스를 관리합니다
          </p>
        </div>
      </div>

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

      {/* Main Layout: side-by-side on desktop, stacked on mobile */}
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
    </div>
  );
}
