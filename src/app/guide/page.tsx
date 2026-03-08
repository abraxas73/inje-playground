"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { HelpCircle } from "lucide-react";
import type { NlmNotebook } from "@/types/guide";
import NotebookTabs from "@/components/guide/NotebookTabs";
import ChatPanel from "@/components/guide/ChatPanel";

export default function GuidePage() {
  const [selectedNotebook, setSelectedNotebook] =
    useState<NlmNotebook | null>(null);

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-xl bg-violet-50 flex items-center justify-center">
          <HelpCircle className="h-5 w-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            이럴때는 어떻게 하지?
          </h1>
          <p className="text-sm text-muted-foreground">
            사내 규정, 가이드 AI Q&A
          </p>
        </div>
      </div>

      {/* Notebook Tabs */}
      <div className="mb-4">
        <NotebookTabs
          onSelect={setSelectedNotebook}
          selectedId={selectedNotebook?.id}
        />
      </div>

      {/* Chat Area */}
      <Card className="animate-fade-up delay-100 overflow-hidden">
        <CardContent className="p-0">
          {selectedNotebook ? (
            <ChatPanel
              key={selectedNotebook.id}
              notebook={selectedNotebook}
            />
          ) : (
            <div className="flex items-center justify-center h-[400px] text-muted-foreground text-sm">
              노트북을 불러오는 중...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
