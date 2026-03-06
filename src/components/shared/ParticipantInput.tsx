"use client";

import { useState, type KeyboardEvent } from "react";

interface ParticipantInputProps {
  onAdd: (names: string[]) => void;
}

export default function ParticipantInput({ onAdd }: ParticipantInputProps) {
  const [value, setValue] = useState("");

  const handleAdd = () => {
    if (!value.trim()) return;
    const names = value
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
    onAdd(names);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="이름 입력 (쉼표로 여러 명 추가)"
        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <button
        onClick={handleAdd}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        추가
      </button>
    </div>
  );
}
