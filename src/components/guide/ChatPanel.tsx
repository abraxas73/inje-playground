"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import type { NlmNotebook, ChatMessage, Citation } from "@/types/guide";

interface ChatPanelProps {
  notebook: NlmNotebook;
}

export default function ChatPanel({ notebook }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Fetch chat history on mount / notebook change
  useEffect(() => {
    let cancelled = false;

    async function fetchHistory() {
      setHistoryLoading(true);
      setMessages([]);
      setConversationId(null);

      try {
        const res = await fetch(
          `/api/guide/chat/history?notebookId=${notebook.id}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const msgs: ChatMessage[] = data.messages ?? [];

        if (!cancelled) {
          setMessages(msgs);
          // Extract last conversation ID
          const lastWithConv = [...msgs]
            .reverse()
            .find((m) => m.conversation_id);
          if (lastWithConv) {
            setConversationId(lastWithConv.conversation_id);
          }
        }
      } catch {
        // silently fail - empty chat is fine
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [notebook.id]);

  // Auto-scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question || isLoading) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Optimistically add user message
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      notebook_id: notebook.id,
      user_email: "",
      conversation_id: conversationId,
      role: "user",
      content: question,
      citations: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/guide/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId: notebook.id,
          question,
          conversationId,
        }),
      });

      if (!res.ok) {
        throw new Error("답변을 가져올 수 없습니다.");
      }

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: `temp-${Date.now()}-assistant`,
        notebook_id: notebook.id,
        user_email: "",
        conversation_id: data.conversationId ?? conversationId,
        role: "assistant",
        content: data.answer,
        citations: data.citations ?? null,
        created_at: new Date().toISOString(),
      };

      if (data.conversationId) {
        setConversationId(data.conversationId);
      }

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `temp-${Date.now()}-error`,
        notebook_id: notebook.id,
        user_email: "",
        conversation_id: conversationId,
        role: "assistant",
        content:
          err instanceof Error
            ? `오류: ${err.message}`
            : "오류가 발생했습니다. 다시 시도해주세요.",
        citations: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-16rem)] min-h-[400px]">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {historyLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
            <div className="h-14 w-14 rounded-2xl bg-violet-50 flex items-center justify-center">
              <BookOpen className="h-7 w-7 text-violet-500" />
            </div>
            <div>
              <p className="text-lg font-medium text-foreground">
                {notebook.title}
              </p>
              {notebook.description && (
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  {notebook.description}
                </p>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              궁금한 것을 질문해보세요
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}

        {isLoading && (
          <div className="flex items-start gap-2">
            <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 bg-violet-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-2 h-2 bg-violet-400 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-2 h-2 bg-violet-400 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t bg-background p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="질문을 입력해주세요 (Enter로 전송, Shift+Enter로 줄바꿈)"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-input bg-transparent px-4 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoading}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="shrink-0 h-10 w-10 rounded-xl bg-violet-600 hover:bg-violet-700"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] space-y-1 ${
          isUser
            ? "bg-violet-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5"
            : "bg-muted rounded-2xl rounded-tl-sm px-4 py-2.5"
        }`}
      >
        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {message.content}
        </div>

        {!isUser && message.citations && message.citations.length > 0 && (
          <CitationsSection citations={message.citations} />
        )}
      </div>
    </div>
  );
}

function CitationsSection({ citations }: { citations: Citation[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 pt-2 border-t border-border/40">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <BookOpen className="h-3 w-3" />
        <span>참고 자료 ({citations.length})</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {citations.map((cite, idx) => (
            <div
              key={`${cite.source_id}-${idx}`}
              className="text-xs bg-background/60 rounded-lg p-2 space-y-1"
            >
              <Badge
                variant="outline"
                className="text-[10px] font-mono"
              >
                출처 {cite.citation_number}
              </Badge>
              <p className="text-muted-foreground leading-relaxed">
                {cite.cited_text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
