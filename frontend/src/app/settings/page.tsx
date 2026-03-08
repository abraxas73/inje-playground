"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings,
  Loader2,
  Check,
  Eye,
  EyeOff,
  FolderOpen,
} from "lucide-react";

interface DoorayProject {
  id: string;
  code: string;
  name: string;
}

export default function UserSettingsPage() {
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const [savedProjectId, setSavedProjectId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [projects, setProjects] = useState<DoorayProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(null);

  // Load user settings
  useEffect(() => {
    fetch("/api/users/settings")
      .then((r) => r.json())
      .then((data) => {
        const t = data.dooray_token ?? "";
        const p = data.dooray_project_id ?? "";
        const pName = data.dooray_project_name ?? "";
        setToken(t);
        setProjectId(p);
        setSavedToken(t);
        setSavedProjectId(p);
        if (pName) setSelectedProjectName(pName);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const hasChanges = token !== savedToken || projectId !== savedProjectId;

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const saves = [
        fetch("/api/users/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "dooray_token", value: token }),
        }),
        fetch("/api/users/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "dooray_project_id", value: projectId }),
        }),
      ];
      // Save project name for display
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        saves.push(
          fetch("/api/users/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: "dooray_project_name",
              value: project.code || project.name,
            }),
          })
        );
        setSelectedProjectName(project.code || project.name);
      }

      await Promise.all(saves);
      setSavedToken(token);
      setSavedProjectId(projectId);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      alert("저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const fetchProjects = useCallback(async () => {
    const t = token.trim();
    if (!t) {
      setProjectError("토큰을 먼저 입력해주세요.");
      return;
    }
    setLoadingProjects(true);
    setProjectError(null);
    try {
      const res = await fetch("/api/dooray/projects", {
        headers: { "x-dooray-token": t },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProjects(data.projects ?? []);
      if (data.projects?.length === 0) {
        setProjectError("접근 가능한 프로젝트가 없습니다.");
      }
    } catch (err) {
      setProjectError(
        err instanceof Error ? err.message : "프로젝트 조회에 실패했습니다."
      );
    } finally {
      setLoadingProjects(false);
    }
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <div className="flex items-center gap-2.5 mb-6">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">설정</h1>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dooray 연동</CardTitle>
          <p className="text-xs text-muted-foreground">
            개인 토큰과 프로젝트를 설정하면 시스템 설정보다 우선 적용됩니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Token */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">API 토큰</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setSaveSuccess(false);
                  }}
                  placeholder="dooray-api 토큰"
                  className="pr-10 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Dooray &gt; 개인 설정 &gt; API &gt; 개인 인증 토큰
            </p>
          </div>

          {/* Project selection */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">프로젝트</label>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchProjects}
                disabled={loadingProjects || !token.trim()}
                className="h-7 text-xs"
              >
                {loadingProjects ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <FolderOpen className="h-3 w-3 mr-1" />
                )}
                프로젝트 불러오기
              </Button>
            </div>

            {projects.length > 0 ? (
              <Select
                value={projectId}
                onValueChange={(val) => {
                  setProjectId(val);
                  setSaveSuccess(false);
                  const p = projects.find((proj) => proj.id === val);
                  if (p) setSelectedProjectName(p.code || p.name);
                }}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="프로젝트를 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        {p.code && (
                          <span className="text-muted-foreground">{p.code}</span>
                        )}
                        {p.name !== p.code && <span>{p.name}</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setSaveSuccess(false);
                  }}
                  placeholder="프로젝트 ID (직접 입력 또는 위에서 불러오기)"
                  className="text-sm"
                />
              </div>
            )}

            {projectId && selectedProjectName && (
              <Badge variant="secondary" className="text-xs">
                {selectedProjectName}
              </Badge>
            )}

            {projectError && (
              <p className="text-xs text-destructive">{projectError}</p>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              size="sm"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : saveSuccess ? (
                <Check className="h-3.5 w-3.5 mr-1.5" />
              ) : null}
              {saveSuccess ? "저장됨" : "저장"}
            </Button>
            {!token && !projectId && (
              <span className="text-xs text-muted-foreground">
                비워두면 시스템 설정을 사용합니다
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
