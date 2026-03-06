"use client";

import { useState, useRef, useEffect, useCallback } from "react";

function hasBatchim(name: string): boolean {
  if (!name) return false;
  const lastChar = name.charCodeAt(name.length - 1);
  // Korean syllable range: 0xAC00 ~ 0xD7A3
  if (lastChar < 0xac00 || lastChar > 0xd7a3) return false;
  return (lastChar - 0xac00) % 28 !== 0;
}

function getParticle(name: string): string {
  return hasBatchim(name) ? "은" : "는";
}

export function useTts() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    synthRef.current = window.speechSynthesis;

    const pickVoice = () => {
      const voices = synthRef.current?.getVoices() ?? [];
      voiceRef.current =
        voices.find((v) => v.lang === "ko-KR") ??
        voices.find((v) => v.lang.startsWith("ko")) ??
        null;
    };

    pickVoice();
    synthRef.current.addEventListener("voiceschanged", pickVoice);
    return () => {
      synthRef.current?.removeEventListener("voiceschanged", pickVoice);
    };
  }, []);

  const speak = useCallback(
    (entries: { participant: string; result: string }[]) => {
      if (typeof window === "undefined" || !synthRef.current) return;

      // Cancel any ongoing speech
      synthRef.current.cancel();

      if (entries.length === 0) return;

      setIsSpeaking(true);

      const queue = [...entries];
      const speakNext = () => {
        if (queue.length === 0) {
          setIsSpeaking(false);
          return;
        }

        const entry = queue.shift()!;
        const particle = getParticle(entry.participant);
        const text = `${entry.participant}${particle} ${entry.result}!`;

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ko-KR";
        utterance.rate = 0.9;
        if (voiceRef.current) {
          utterance.voice = voiceRef.current;
        }
        utterance.onend = speakNext;
        utterance.onerror = speakNext;

        synthRef.current!.speak(utterance);
      };

      speakNext();
    },
    []
  );

  const stop = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsSpeaking(false);
  }, []);

  return { speak, stop, isSpeaking };
}
