/**
 * 매핑 운영 설정(전역 settings 테이블). 지금은 규칙 엔진의 요구사항당 후보 상한 하나뿐이다 — 어드민 `/admin/rfp-catalog`에서 지정한다.
 * 값 검증은 여기 한 곳에서만 한다(화면·API·잡이 같은 규칙을 쓰게).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAPPING_MAX_CANDIDATES_KEY = "rfp_mapping_max_candidates";
export const MAPPING_CANDIDATES_MIN = 1;
export const MAPPING_CANDIDATES_MAX = 5;
export const MAPPING_CANDIDATES_DEFAULT = 5;

/**
 * 설정값(문자열·숫자·null) → 1~5 정수. 비었거나(빈 문자열 = 미설정) 숫자가 아니면 기본값, 범위를 벗어나면 잘라 넣는다.
 * 빈 문자열을 0으로 보면 상한이 1이 되어 후보가 하나만 남으므로 반드시 기본값으로 돌린다.
 */
export function parseMaxCandidates(raw: unknown): number {
  const text = typeof raw === "string" ? raw.trim() : null;
  if (text === "") return MAPPING_CANDIDATES_DEFAULT;
  const n = typeof raw === "number" ? raw : text !== null ? Number(text) : NaN;
  if (!Number.isFinite(n)) return MAPPING_CANDIDATES_DEFAULT;
  return Math.min(MAPPING_CANDIDATES_MAX, Math.max(MAPPING_CANDIDATES_MIN, Math.floor(n)));
}

/** settings 테이블에서 후보 상한을 읽는다. 행이 없거나 조회가 실패하면 기본값(5) — 매핑이 설정 때문에 멈추지 않게. */
export async function loadMappingMaxCandidates(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.from("settings").select("value").eq("key", MAPPING_MAX_CANDIDATES_KEY).maybeSingle();
  if (error || !data) return MAPPING_CANDIDATES_DEFAULT;
  return parseMaxCandidates((data as { value: unknown }).value);
}
