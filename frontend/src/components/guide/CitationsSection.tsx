"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import type { Citation } from "@/types/guide";

interface CitationsSectionProps {
  citations: Citation[];
}

/** Filter out empty/meaningless citations and deduplicate */
function getUniqueCitations(citations: Citation[]): Citation[] {
  const filtered = citations.filter((cite) => {
    const text = (cite.cited_text ?? "").trim();
    if (!text || text.length < 5) return false;
    if (/^(출처\s*\d*|\d+)$/.test(text)) return false;
    return true;
  });

  const seen = new Set<string>();
  return filtered.filter((cite) => {
    const key = cite.cited_text.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function CitationsSection({ citations }: CitationsSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const unique = getUniqueCitations(citations);
  if (unique.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-border/40">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <BookOpen className="h-3 w-3" />
        <span>참고 자료 ({unique.length})</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {unique.map((cite, idx) => (
            <div
              key={`${cite.source_id}-${idx}`}
              className="text-xs bg-background/60 rounded-lg p-2 space-y-1"
            >
              <Badge
                variant="outline"
                className="text-[10px] font-mono"
              >
                출처 {idx + 1}
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
