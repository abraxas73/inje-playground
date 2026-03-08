"use client";

import { useRef, useCallback, useEffect } from "react";
import type { ResultType } from "@/types/ladder";

// Different tones for each individual path trace
const TRACE_NOTES = [
  [523.25, 659.25, 783.99],  // C5 E5 G5
  [587.33, 739.99, 880.0],   // D5 F#5 A5
  [659.25, 830.61, 987.77],  // E5 G#5 B5
  [698.46, 880.0, 1046.5],   // F5 A5 C6
  [783.99, 987.77, 1174.66], // G5 B5 D6
  [440.0, 554.37, 659.25],   // A4 C#5 E5
  [493.88, 622.25, 739.99],  // B4 D#5 F#5
  [329.63, 415.3, 493.88],   // E4 G#4 B4
];

export function useSfx() {
  const ctxRef = useRef<AudioContext | null>(null);
  const indexRef = useRef(0);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  // Quick arpeggio when a single path starts tracing
  const playTrace = useCallback(() => {
    const ctx = getCtx();
    const notes = TRACE_NOTES[indexRef.current % TRACE_NOTES.length];
    indexRef.current++;
    const now = ctx.currentTime;

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.08 + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + i * 0.08 + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.2);
    });
  }, [getCtx]);

  // Play result reveal sound based on type
  const playResult = useCallback((type: ResultType) => {
    const ctx = getCtx();
    const now = ctx.currentTime;

    if (type === "reward") {
      // Triumphant ascending fanfare
      const freqs = [523.25, 659.25, 783.99, 1046.5];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.1);
        gain.gain.linearRampToValueAtTime(0.25, now + i * 0.1 + 0.03);
        gain.gain.linearRampToValueAtTime(i === freqs.length - 1 ? 0.2 : 0, now + i * 0.1 + 0.3);
        if (i === freqs.length - 1) {
          gain.gain.linearRampToValueAtTime(0, now + i * 0.1 + 0.8);
        }
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 1);
      });
    } else if (type === "punishment") {
      // Descending "wah wah" trombone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(350, now);
      osc.frequency.linearRampToValueAtTime(250, now + 0.3);
      osc.frequency.linearRampToValueAtTime(200, now + 0.6);
      osc.frequency.linearRampToValueAtTime(130, now + 1.0);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.setValueAtTime(0.15, now + 0.2);
      gain.gain.linearRampToValueAtTime(0.05, now + 0.3);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.4);
      gain.gain.linearRampToValueAtTime(0.05, now + 0.5);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.6);
      gain.gain.linearRampToValueAtTime(0, now + 1.0);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 1.1);
    } else {
      // Neutral "ding"
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    }
  }, [getCtx]);

  const resetIndex = useCallback(() => {
    indexRef.current = 0;
  }, []);

  return { playTrace, playResult, resetIndex };
}
