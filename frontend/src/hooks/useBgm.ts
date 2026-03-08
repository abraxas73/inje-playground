"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { PresetName } from "@/lib/bgm-presets";
import { PRESETS } from "@/lib/bgm-presets";

export function useBgm() {
  const [preset, setPreset] = useState<PresetName>("exciting");
  const [volume, setVolume] = useState(70);
  const [isPlaying, setIsPlaying] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getAudioContext = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
      gainRef.current = ctxRef.current.createGain();
      gainRef.current.connect(ctxRef.current.destination);
    }
    return { ctx: ctxRef.current, gain: gainRef.current! };
  }, []);

  // Update volume in real-time
  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value = volume / 100;
    }
  }, [volume]);

  const play = useCallback(() => {
    if (typeof window === "undefined") return;

    const { ctx, gain } = getAudioContext();

    // Stop previous
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
    }

    if (ctx.state === "suspended") {
      ctx.resume();
    }

    gain.gain.value = volume / 100;

    const scheduleLoop = () => {
      const presetFn = PRESETS[preset];
      const { endTime, stopAll } = presetFn(ctx, gain, ctx.currentTime + 0.05);
      stopRef.current = stopAll;

      const loopDuration = (endTime - ctx.currentTime) * 1000 - 100;
      loopTimerRef.current = setTimeout(() => {
        if (isPlayingRef.current) {
          scheduleLoop();
        }
      }, Math.max(0, loopDuration));
    };

    isPlayingRef.current = true;
    setIsPlaying(true);
    scheduleLoop();
  }, [getAudioContext, preset, volume]);

  const isPlayingRef = useRef(false);

  const stop = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);

    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }

    if (gainRef.current && ctxRef.current) {
      const now = ctxRef.current.currentTime;
      gainRef.current.gain.setValueAtTime(gainRef.current.gain.value, now);
      gainRef.current.gain.linearRampToValueAtTime(0, now + 0.3);

      setTimeout(() => {
        if (stopRef.current) {
          stopRef.current();
          stopRef.current = null;
        }
        if (gainRef.current) {
          gainRef.current.gain.value = volume / 100;
        }
      }, 350);
    }
  }, [volume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
      if (stopRef.current) stopRef.current();
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
      }
    };
  }, []);

  return { preset, setPreset, volume, setVolume, isPlaying, play, stop };
}
