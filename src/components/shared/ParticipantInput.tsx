"use client";

import { useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

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
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="이름 입력 (쉼표로 여러 명 추가)"
      />
      <Button onClick={handleAdd} size="default">
        <Plus className="h-4 w-4 mr-1" />
        추가
      </Button>
    </div>
  );
}
