/** 청크당 요구사항 수(스펙 §4.3). 124건 → 7청크. */
export const CHUNK_SIZE = 20;
/** 프롬프트에 넣는 세부 내용 최대 길이 */
export const DETAILS_MAX_CHARS = 1500;

export interface ChunkRequirement {
  /** rfp_requirements.id */
  id: string;
  reqId: string;
  title: string;
  categoryName: string;
  definition: string;
  details: string;
}

export function truncateDetails(text: string, max = DETAILS_MAX_CHARS): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…(이하 생략)`;
}

export function chunkRequirements<T>(rows: readonly T[], size = CHUNK_SIZE): T[][] {
  if (size < 1) throw new Error("청크 크기는 1 이상이어야 합니다.");
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
