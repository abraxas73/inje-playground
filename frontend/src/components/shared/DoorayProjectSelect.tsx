"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Loader2, X } from "lucide-react";
import { fetchProjects as fetchDoorayProjects } from "@/lib/dooray-client";

interface DoorayProject {
  id: string;
  code: string;
  name: string;
  description: string;
}

interface DoorayProjectSelectProps {
  value: string;
  onChange: (projectId: string) => void;
}

export default function DoorayProjectSelect({
  value,
  onChange,
}: DoorayProjectSelectProps) {
  const [token, setToken] = useState<string | null>(null);
  const [projects, setProjects] = useState<DoorayProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  // Load token from user/system settings
  useEffect(() => {
    (async () => {
      try {
        const [userRes, sysRes] = await Promise.all([
          fetch("/api/users/settings"),
          fetch("/api/settings"),
        ]);
        const userSettings = userRes.ok ? await userRes.json() : {};
        const sysSettings = sysRes.ok ? await sysRes.json() : {};
        setToken(userSettings.dooray_token || sysSettings.dooray_token || null);
      } catch {
        // silent
      }
    })();
  }, []);

  const fetchProjects = useCallback(async () => {
    if (!token) {
      setError("설정에서 Dooray 토큰을 먼저 설정해주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 브라우저에서 Dooray API 직접 호출
      const result = await fetchDoorayProjects(token);
      setProjects(result);
      if (!result.length) {
        setError("접근 가능한 프로젝트가 없습니다.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "프로젝트 조회 실패"
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  const handleClear = () => {
    onChange("");
    setSelectedName(null);
  };

  // If we have a value but no name yet, try to find it in loaded projects
  useEffect(() => {
    if (value && projects.length > 0 && !selectedName) {
      const p = projects.find((proj) => proj.id === value);
      if (p) setSelectedName(p.code || p.name);
    }
  }, [value, projects, selectedName]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        두레이 프로젝트
      </span>

      {projects.length > 0 ? (
        <Select
          value={value || undefined}
          onValueChange={(val) => {
            onChange(val);
            const p = projects.find((proj) => proj.id === val);
            if (p) setSelectedName(p.code || p.name);
          }}
        >
          <SelectTrigger className="h-8 text-xs w-auto min-w-[180px] max-w-[300px]">
            <SelectValue placeholder="프로젝트 선택" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{p.code || p.name}</span>
                  {p.description && (
                    <span className="text-xs text-muted-foreground line-clamp-1">
                      {p.description}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchProjects}
          disabled={loading || !token}
          className="h-7 text-xs"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <FolderOpen className="h-3 w-3 mr-1" />
          )}
          프로젝트 불러오기
        </Button>
      )}

      {value && selectedName && (
        <Badge variant="secondary" className="text-xs gap-1">
          {selectedName}
          <button onClick={handleClear} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
