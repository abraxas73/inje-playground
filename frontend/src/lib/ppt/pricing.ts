/**
 * LLM 토큰 단가(USD / 1M 토큰) — Anthropic 1st-party API 공개 요금, 2026-09-25 기준(claude-api 참조 스킬).
 * 캐시 쓰기 = 입력 ×1.25, 캐시 읽기 = 모델별 공시값. 단가가 바뀌면 이 표만 고친다.
 * ponytail: 모르는 모델은 null — 화면은 "단가 미등록"으로 표시한다.
 */
import type { PptTokens } from "@/types/ppt";

export interface ModelPrice { input: number; output: number; cacheWrite: number; cacheRead: number }

export const PRICES_USD_PER_M: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-fable-5-1": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
};
export const PRICES_AS_OF = "2026-09";

/** 버전 행의 토큰 합계 → 추정 비용(USD). 단가 없는 모델은 null. */
export function estimateCostUsd(model: string | null | undefined, t: PptTokens): number | null {
  if (!model) return null;
  const p = PRICES_USD_PER_M[model];
  if (!p) return null;
  // usage.input_tokens는 캐시에 안 잡힌 입력만 센다(SDK 규약) — 세 항목을 각자 단가로 더한다.
  return (t.in * p.input + t.out * p.output + t.cacheWrite * p.cacheWrite + t.cacheRead * p.cacheRead) / 1_000_000;
}

/** $0.0123 형식. 1센트 미만은 소수 4자리, 그 이상은 2자리. */
export function formatUsd(v: number): string {
  return `$${v.toFixed(v < 0.01 ? 4 : v < 1 ? 3 : 2)}`;
}
