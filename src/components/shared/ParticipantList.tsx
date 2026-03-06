"use client";

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
      <p className="text-sm text-slate-400 py-4 text-center">
        참여자를 추가해주세요
      </p>
    );
  }

  const isCardHolder = (name: string) => cardHolders?.has(name) ?? false;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-600">
          참여자 ({participants.length}명)
          {cardHolders && cardHolders.size > 0 && (
            <span className="ml-2 text-amber-600">
              법카 {cardHolders.size}명
            </span>
          )}
        </span>
        <button
          onClick={onClear}
          className="text-xs text-red-500 hover:text-red-700 transition-colors"
        >
          전체 삭제
        </button>
      </div>
      {onToggleCard && (
        <p className="text-xs text-slate-400 mb-2">
          이름을 클릭하면 법카 소지자를 지정할 수 있습니다
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {participants.map((name, index) => {
          const hasCard = isCardHolder(name);
          return (
            <span
              key={`${name}-${index}`}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm ${
                hasCard
                  ? "bg-amber-100 border border-amber-300"
                  : "bg-slate-100"
              } ${onToggleCard ? "cursor-pointer select-none" : ""}`}
              onClick={() => onToggleCard?.(name)}
            >
              {name}
              {hasCard && (
                <span className="text-xs font-medium text-amber-700 bg-amber-200 px-1.5 py-0.5 rounded-full">
                  법카
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(index);
                }}
                className="text-slate-400 hover:text-red-500 transition-colors ml-1"
                aria-label={`${name} 삭제`}
              >
                &times;
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
