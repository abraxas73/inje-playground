"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
import { Check, ChevronsUpDown, FolderOpen, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const [open, setOpen] = useState(false);

  // Load token from user/system settings (개인 설정 우선)
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
  };

  const selectedProject = projects.find((p) => p.id === value);
  const selectedLabel = selectedProject
    ? selectedProject.code || selectedProject.name
    : null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        두레이 프로젝트
      </span>

      {projects.length > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="h-8 text-xs w-auto min-w-[180px] max-w-[300px] justify-between font-normal"
            >
              <span className="truncate">
                {selectedLabel || "프로젝트 선택"}
              </span>
              <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
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
                        onChange(p.id);
                        setOpen(false);
                      }}
                      className="text-xs"
                    >
                      <Check
                        className={cn(
                          "mr-1.5 h-3 w-3 shrink-0",
                          value === p.id ? "opacity-100" : "opacity-0"
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

      {value && selectedLabel && (
        <Badge variant="secondary" className="text-xs gap-1">
          {selectedLabel}
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
