"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import type { DoorayMember } from "@/types/dooray";
import { fetchProjectMembers } from "@/lib/dooray-client";
import { logAction } from "@/lib/action-log";

interface DoorayImportButtonProps {
  onImport: (names: string[]) => void;
  projectId?: string;
  /** 가져온 멤버를 user_members DB에도 저장 */
  onImportedMembers?: (members: { name: string; dooray_member_id?: string }[]) => void;
}

export default function DoorayImportButton({
  onImport,
  projectId: overrideProjectId,
  onImportedMembers,
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

  /** 가져온 멤버를 dooray_members 테이블에 캐시 저장 */
  const saveMembersToCache = async (members: DoorayMember[]) => {
    try {
      await fetch("/api/dooray/members/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members }),
      });
    } catch {
      // 캐시 저장 실패는 무시
    }
  };

  const handleImport = async () => {
    setError(null);
    setInfo(null);
    setOriginalError(null);
    setLoading(true);

    try {
      // 설정에서 토큰/프로젝트ID 가져오기 (개인 설정 우선)
      const [userSettingsRes, settingsRes] = await Promise.all([
        fetch("/api/users/settings"),
        fetch("/api/settings"),
      ]);
      const userSettings = userSettingsRes.ok ? await userSettingsRes.json() : {};
      const settings = settingsRes.ok ? await settingsRes.json() : {};

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

      // 브라우저에서 Dooray API 직접 호출 (Chrome 확장이 CORS 처리)
      const members = await fetchProjectMembers(token, projectId);
      const names = members.map((m) => m.name);
      onImport(names);

      // DB에 캐시 저장 (다음 fallback용)
      saveMembersToCache(members);

      // user_members DB에 저장
      if (onImportedMembers) {
        onImportedMembers(
          members.map((m) => ({
            name: m.name,
            dooray_member_id: m.id,
          }))
        );
      }

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
