"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import type { DoorayMember } from "@/types/dooray";
import { logAction } from "@/lib/action-log";

interface DoorayImportButtonProps {
  onImport: (names: string[]) => void;
  projectId?: string;
}

export default function DoorayImportButton({
  onImport,
  projectId: overrideProjectId,
}: DoorayImportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [originalError, setOriginalError] = useState<string | null>(null);

  const fallbackFromDB = async (errorMsg?: string) => {
    const dbRes = await fetch("/api/dooray/members/db");
    if (!dbRes.ok) return false;
    const dbData = await dbRes.json();
    if (dbData.members?.length) {
      const names = dbData.members.map((m: DoorayMember) => m.name);
      onImport(names);
      setInfo("두레이 연결이 되지 않아, 저장된 리스트를 사용합니다.");
      if (errorMsg) setOriginalError(errorMsg);
      logAction("DB 멤버 가져오기 (fallback)", "dooray", { memberCount: names.length });
      return true;
    }
    return false;
  };

  const handleImport = async () => {
    setError(null);
    setInfo(null);
    setOriginalError(null);
    setLoading(true);

    try {
      // Fetch user settings and system settings in parallel
      const [userSettingsRes, settingsRes] = await Promise.all([
        fetch("/api/users/settings"),
        fetch("/api/settings"),
      ]);
      const userSettings = userSettingsRes.ok ? await userSettingsRes.json() : {};
      const settings = settingsRes.ok ? await settingsRes.json() : {};

      // User settings override system settings
      const token = userSettings.dooray_token || settings.dooray_token;
      const projectId =
        overrideProjectId?.trim() ||
        userSettings.dooray_project_id ||
        settings.dooray_project_id;

      if (!token || !projectId) {
        const ok = await fallbackFromDB("토큰 또는 프로젝트 ID가 설정되지 않았습니다.");
        if (!ok) {
          setError("설정 페이지에서 Dooray 연동을 확인해주세요.");
        }
        return;
      }

      const res = await fetch(
        `/api/dooray/members?projectId=${encodeURIComponent(projectId)}`,
        {
          headers: { "x-dooray-token": token },
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || `API 오류 (${res.status})`;
        const ok = await fallbackFromDB(errMsg);
        if (!ok) {
          throw new Error(errMsg);
        }
        return;
      }

      const data: { members: DoorayMember[] } = await res.json();
      const names = data.members.map((m) => m.name);
      onImport(names);
      logAction("Dooray 멤버 가져오기", "dooray", { memberCount: names.length, projectId });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "오류가 발생했습니다.";
      const ok = await fallbackFromDB(errMsg);
      if (!ok) {
        setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Button onClick={handleImport} disabled={loading} variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
        {loading ? (
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
        ) : (
          <Download className="h-4 w-4 mr-1.5" />
        )}
        {loading ? "불러오는 중..." : "Dooray에서 가져오기"}
      </Button>
      {error && <p className="text-destructive text-xs mt-1">{error}</p>}
      {info && (
        <p className="text-amber-600 text-xs mt-1 cursor-help" title={originalError || undefined}>
          {info}
        </p>
      )}
    </div>
  );
}
