"use client";

import { useState } from "react";
import type { DoorayMember } from "@/types/dooray";

interface DoorayImportButtonProps {
  onImport: (names: string[]) => void;
}

export default function DoorayImportButton({
  onImport,
}: DoorayImportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    setError(null);
    setLoading(true);

    try {
      const token = localStorage.getItem("dooray-token");
      const projectId = localStorage.getItem("dooray-project-id");

      if (!token || !projectId) {
        setError("설정 페이지에서 Dooray 토큰과 프로젝트 ID를 입력해주세요.");
        return;
      }

      const parsedToken = JSON.parse(token);
      const parsedProjectId = JSON.parse(projectId);

      const res = await fetch(
        `/api/dooray/members?projectId=${encodeURIComponent(parsedProjectId)}`,
        {
          headers: { "x-dooray-token": parsedToken },
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "멤버 조회에 실패했습니다.");
      }

      const data: { members: DoorayMember[] } = await res.json();
      const names = data.members.map((m) => m.name);
      onImport(names);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleImport}
        disabled={loading}
        className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "불러오는 중..." : "Dooray에서 가져오기"}
      </button>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}
