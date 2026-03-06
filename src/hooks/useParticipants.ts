"use client";

import { useLocalStorage } from "./useLocalStorage";

export function useParticipants(storageKey: string = "participants") {
  const [participants, setParticipants, isLoaded] = useLocalStorage<string[]>(
    storageKey,
    []
  );

  const addParticipants = (names: string[]) => {
    const trimmed = names.map((n) => n.trim()).filter((n) => n.length > 0);
    setParticipants((prev) => [...prev, ...trimmed]);
  };

  const removeParticipant = (index: number) => {
    setParticipants((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setParticipants([]);
  };

  const setAll = (names: string[]) => {
    setParticipants(names);
  };

  return {
    participants,
    addParticipants,
    removeParticipant,
    clearAll,
    setAll,
    isLoaded,
  };
}
