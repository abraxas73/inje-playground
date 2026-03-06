"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Trash2, CreditCard } from "lucide-react";

interface ParticipantListProps {
  participants: string[];
  onRemove: (index: number) => void;
  onClear: () => void;
  cardHolders?: Set<string>;
  onToggleCard?: (name: string) => void;
}

export default function ParticipantList({
  participants,
  onRemove,
  onClear,
  cardHolders,
  onToggleCard,
}: ParticipantListProps) {
  if (participants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        참여자를 추가해주세요
      </p>
    );
  }

  const isCardHolder = (name: string) => cardHolders?.has(name) ?? false;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">
          참여자 ({participants.length}명)
          {cardHolders && cardHolders.size > 0 && (
            <span className="ml-2 text-amber-600 font-medium">
              <CreditCard className="inline h-3.5 w-3.5 mr-0.5" />
              법카 {cardHolders.size}명
            </span>
          )}
        </span>
        <Button variant="ghost" size="sm" onClick={onClear} className="text-destructive hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          전체 삭제
        </Button>
      </div>
      {onToggleCard && (
        <p className="text-xs text-muted-foreground mb-2">
          이름을 클릭하면 법카 소지자를 지정할 수 있습니다
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {participants.map((name, index) => {
          const hasCard = isCardHolder(name);
          return (
            <Badge
              key={`${name}-${index}`}
              variant={hasCard ? "default" : "secondary"}
              className={`py-1.5 px-3 text-sm gap-1.5 ${
                hasCard
                  ? "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200"
                  : ""
              } ${onToggleCard ? "cursor-pointer select-none" : ""}`}
              onClick={() => onToggleCard?.(name)}
            >
              {name}
              {hasCard && (
                <span className="text-[10px] font-semibold bg-amber-300 text-amber-900 px-1.5 py-0.5 rounded-full">
                  법카
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(index);
                }}
                className="ml-0.5 rounded-full hover:bg-black/10 p-0.5 transition-colors"
                aria-label={`${name} 삭제`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
