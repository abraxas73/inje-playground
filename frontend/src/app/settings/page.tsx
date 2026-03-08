"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Settings,
  Loader2,
  Check,
  Eye,
  EyeOff,
  FolderOpen,
  ChevronsUpDown,
  UserCheck,
  Users,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchProjects as fetchDoorayProjects, fetchProjectMembers } from "@/lib/dooray-client";

interface DoorayProject {
  id: string;
  code: string;
  name: string;
  description: string;
}

interface DoorayMember {
  id: string;
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

  // Project combobox
  const [projects, setProjects] = useState<DoorayProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);

  // 본인 인증
  const [members, setMembers] = useState<DoorayMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const [savedMemberId, setSavedMemberId] = useState("");
  const [savedMemberName, setSavedMemberName] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedMemberName, setSelectedMemberName] = useState("");
  const [savingMember, setSavingMember] = useState(false);
  const [saveMemberSuccess, setSaveMemberSuccess] = useState(false);

  // Load user settings
  useEffect(() => {
    fetch("/api/users/settings")
      .then((r) => r.json())
      .then((data) => {
        const t = data.dooray_token ?? "";
        const p = data.dooray_project_id ?? "";
        const pName = data.dooray_project_name ?? "";
        const mId = data.dooray_member_id ?? "";
        const mName = data.dooray_member_name ?? "";
        setToken(t);
        setProjectId(p);
        setSavedToken(t);
        setSavedProjectId(p);
        if (pName) setSelectedProjectName(pName);
        setSavedMemberId(mId);
        setSavedMemberName(mName);
        setSelectedMemberId(mId);
        setSelectedMemberName(mName);
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

  const fetchProjectList = useCallback(async () => {
    const t = token.trim();
    if (!t) {
      setProjectError("토큰을 먼저 입력해주세요.");
      return;
    }
    setLoadingProjects(true);
    setProjectError(null);
    try {
      const result = await fetchDoorayProjects(t);
      setProjects(result);
      if (result.length === 0) {
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

  const fetchMemberList = useCallback(async () => {
    const t = token.trim();
    const p = projectId.trim();
    if (!t || !p) {
      setMemberError("토큰과 프로젝트를 먼저 설정해주세요.");
      return;
    }
    setLoadingMembers(true);
    setMemberError(null);
    try {
      const result = await fetchProjectMembers(t, p);
      setMembers(result);
      if (result.length === 0) {
        setMemberError("구성원을 찾을 수 없습니다.");
      }
    } catch (err) {
      setMemberError(
        err instanceof Error ? err.message : "구성원 조회에 실패했습니다."
      );
    } finally {
      setLoadingMembers(false);
    }
  }, [token, projectId]);

  const handleSaveMember = async () => {
    setSavingMember(true);
    setSaveMemberSuccess(false);
    try {
      await Promise.all([
        fetch("/api/users/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "dooray_member_id", value: selectedMemberId }),
        }),
        fetch("/api/users/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "dooray_member_name", value: selectedMemberName }),
        }),
      ]);
      setSavedMemberId(selectedMemberId);
      setSavedMemberName(selectedMemberName);
      setSaveMemberSuccess(true);
      setTimeout(() => setSaveMemberSuccess(false), 2000);
    } catch {
      alert("저장에 실패했습니다.");
    } finally {
      setSavingMember(false);
    }
  };

  const hasMemberChanges = selectedMemberId !== savedMemberId;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedProject = projects.find((p) => p.id === projectId);
  const projectLabel = selectedProject
    ? selectedProject.code || selectedProject.name
    : selectedProjectName || null;

  return (
    <div className="max-w-lg mx-auto py-8 px-4 space-y-4">
      <div className="flex items-center gap-2.5 mb-6">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">설정</h1>
      </div>

      {/* Dooray 연동 */}
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

          {/* Project selection - combobox */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">프로젝트</label>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchProjectList}
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
              <Popover open={projectOpen} onOpenChange={setProjectOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={projectOpen}
                    className="w-full justify-between text-sm font-normal"
                  >
                    <span className="truncate">
                      {projectLabel || "프로젝트를 선택하세요"}
                    </span>
                    <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="프로젝트 검색..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty>검색 결과 없음</CommandEmpty>
                      <CommandGroup>
                        {projects.map((p) => (
                          <CommandItem
                            key={p.id}
                            value={`${p.code} ${p.name} ${p.description}`}
                            onSelect={() => {
                              setProjectId(p.id);
                              setSelectedProjectName(p.code || p.name);
                              setSaveSuccess(false);
                              setProjectOpen(false);
                            }}
                            className="text-xs"
                          >
                            <Check
                              className={cn(
                                "mr-1.5 h-3 w-3 shrink-0",
                                projectId === p.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="font-medium truncate">{p.code || p.name}</span>
                              {p.description && (
                                <span className="text-muted-foreground line-clamp-1">
                                  {p.description}
                                </span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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

      {/* 본인 인증 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            본인 인증
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Dooray 구성원 중 본인을 선택하면 알림(1:1 메시지)을 받을 수 있습니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {savedMemberName && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs gap-1.5">
                <UserCheck className="h-3 w-3" />
                {savedMemberName}
              </Badge>
              <span className="text-[11px] text-muted-foreground">인증됨</span>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchMemberList}
                disabled={loadingMembers || !token.trim() || !projectId.trim()}
                className="text-xs"
              >
                {loadingMembers ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Users className="h-3 w-3 mr-1" />
                )}
                구성원 불러오기
              </Button>
              {(!token.trim() || !projectId.trim()) && (
                <span className="text-[11px] text-muted-foreground">
                  토큰과 프로젝트를 먼저 설정하세요
                </span>
              )}
            </div>

            {members.length > 0 && (
              <Popover open={memberOpen} onOpenChange={setMemberOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={memberOpen}
                    className="w-full justify-between text-sm font-normal"
                  >
                    <span className="truncate">
                      {selectedMemberName || "본인을 선택하세요"}
                    </span>
                    <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="이름 검색..." className="h-8 text-xs" />
                    <CommandList>
                      <CommandEmpty>검색 결과 없음</CommandEmpty>
                      <CommandGroup>
                        {members.map((m) => (
                          <CommandItem
                            key={m.id}
                            value={m.name}
                            onSelect={() => {
                              setSelectedMemberId(m.id);
                              setSelectedMemberName(m.name);
                              setMemberOpen(false);
                            }}
                            className="text-xs"
                          >
                            <Check
                              className={cn(
                                "mr-1.5 h-3 w-3 shrink-0",
                                selectedMemberId === m.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {m.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}

            {memberError && (
              <p className="text-xs text-destructive">{memberError}</p>
            )}
          </div>

          {members.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={handleSaveMember}
                disabled={savingMember || !hasMemberChanges || !selectedMemberId}
                size="sm"
              >
                {savingMember ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : saveMemberSuccess ? (
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                ) : null}
                {saveMemberSuccess ? "저장됨" : "본인 인증 저장"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual link */}
      <a
        href="/manual"
        className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-4"
      >
        <BookOpen className="h-4 w-4" />
        사용자 매뉴얼 보기
      </a>
    </div>
  );
}
