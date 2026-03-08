"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import type { NlmNotebook } from "@/types/guide";

interface NotebookTabsProps {
  onSelect: (notebook: NlmNotebook) => void;
  selectedId?: string;
}

export default function NotebookTabs({ onSelect, selectedId }: NotebookTabsProps) {
  const [notebooks, setNotebooks] = useState<NlmNotebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchNotebooks() {
      try {
        const res = await fetch("/api/guide/notebooks?visible=true");
        if (!res.ok) throw new Error("노트북 목록을 불러올 수 없습니다.");
        const data = await res.json();
        const list: NlmNotebook[] = data.notebooks ?? [];
        setNotebooks(list);

        // Auto-select first notebook if none selected
        if (list.length > 0 && !selectedId) {
          onSelect(list[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    }

    fetchNotebooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive text-center py-2">{error}</p>
    );
  }

  if (notebooks.length === 0) {
    return null;
  }

  // Single notebook: auto-selected, no tabs needed
  if (notebooks.length === 1) {
    return null;
  }

  return (
    <Tabs
      value={selectedId ?? notebooks[0]?.id}
      onValueChange={(value) => {
        const nb = notebooks.find((n) => n.id === value);
        if (nb) onSelect(nb);
      }}
    >
      <TabsList className="w-full justify-start overflow-x-auto">
        {notebooks.map((nb) => (
          <TabsTrigger key={nb.id} value={nb.id} className="text-sm">
            {nb.title}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
