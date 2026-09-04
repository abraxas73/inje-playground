import { isVerdict, requiresFeature, type CatalogSolution, type MappingRow, type Verdict } from "./types";
import type { CatalogAliases } from "./prompt";
import type { ChunkRequirement } from "./chunk";

export const MAX_ROWS_PER_REQUIREMENT = 5;

/** LLM 출력 한 행(별칭 상태) */
export interface LlmMappingItem {
  reqId: string;
  verdict: Verdict;
  feature: string | null;
  rationale: string;
}

/** 검증을 통과해 DB에 넣을 행 */
export interface ValidatedRow {
  requirementId: string;
  solutionCode: string | null;
  featureId: string | null;
  verdict: Verdict;
  rationale: string;
  sortOrder: number;
}

export interface ValidationResult {
  rows: ValidatedRow[];
  warnings: string[];
  /** 행을 하나도 못 받은 요구사항의 reqId */
  unmapped: string[];
}

interface Candidate {
  verdict: Verdict;
  solutionCode: string | null;
  featureId: string | null;
  rationale: string;
}

/** 스펙 §4.3 검증 1~6. 순수 함수. */
export function validateMappingOutput(items: LlmMappingItem[], chunk: readonly ChunkRequirement[], aliases: CatalogAliases): ValidationResult {
  const byReqId = new Map(chunk.map((r) => [r.reqId.replace(/\s+/g, "").toUpperCase(), r]));
  const warnings: string[] = [];
  const unmapped: string[] = [];
  const cands = new Map<string, Candidate[]>();

  for (const it of items) {
    const req = byReqId.get(it.reqId.replace(/\s+/g, "").toUpperCase());
    if (!req) {
      warnings.push(`청크에 없는 요구사항 ID ${it.reqId}`);
      continue;
    }
    if (!isVerdict(it.verdict)) {
      warnings.push(`${req.reqId}: 알 수 없는 판정 ${String(it.verdict)}`);
      continue;
    }
    let solutionCode: string | null = null;
    let featureId: string | null = null;
    if (requiresFeature(it.verdict)) {
      const f = it.feature ? aliases.features.get(it.feature.trim().toUpperCase()) : undefined;
      if (!f) {
        warnings.push(`${req.reqId}: 기능 별칭 불명 ${it.feature ?? "null"}`);
        continue;
      }
      solutionCode = f.solutionCode;
      featureId = f.featureId;
    }
    // build/na에 feature가 붙어 있으면 feature만 버리고 행은 유지(규칙 3)
    const list = cands.get(req.id) ?? [];
    list.push({ verdict: it.verdict, solutionCode, featureId, rationale: it.rationale.trim() });
    cands.set(req.id, list);
  }

  const rows: ValidatedRow[] = [];
  for (const req of chunk) {
    let list = cands.get(req.id) ?? [];
    if (list.some((c) => requiresFeature(c.verdict))) {
      const dropped = list.filter((c) => !requiresFeature(c.verdict)).length;
      if (dropped) warnings.push(`${req.reqId}: 충족/부분충족과 함께 나온 설계·구축영역/해당없음 ${dropped}행 제외`);
      const seen = new Set<string>();
      list = list.filter((c) => {
        if (!requiresFeature(c.verdict) || seen.has(c.featureId!)) return false;
        seen.add(c.featureId!);
        return true;
      });
    } else if (list.length > 1) {
      // build와 na가 섞이면 build만, 같은 판정이 여럿이면 첫 행(규칙 4)
      list = [list.find((c) => c.verdict === "build") ?? list[0]];
    }
    if (list.length > MAX_ROWS_PER_REQUIREMENT) {
      warnings.push(`${req.reqId}: 매핑 ${list.length}행 중 ${MAX_ROWS_PER_REQUIREMENT}행만 사용`);
      list = list.slice(0, MAX_ROWS_PER_REQUIREMENT);
    }
    if (!list.length) {
      unmapped.push(req.reqId);
      warnings.push(`${req.reqId}: 매핑 결과 없음`);
      continue;
    }
    list.forEach((c, i) => rows.push({ requirementId: req.id, solutionCode: c.solutionCode, featureId: c.featureId, verdict: c.verdict, rationale: c.rationale, sortOrder: i }));
  }
  return { rows, warnings, unmapped };
}

export interface ManualMappingInput {
  verdict: unknown;
  solutionCode?: unknown;
  featureId?: unknown;
}

export type ManualCheck =
  | { ok: true; verdict: Verdict; solutionCode: string | null; featureId: string | null }
  | { ok: false; error: string };

/**
 * 스펙 §4.2 규칙을 PATCH/POST 입력에 적용한다. siblings는 같은 요구사항의 다른 행(수정 중인 자기 행은 제외).
 * 충족·부분충족은 기능 필수이고 기능의 솔루션으로 solutionCode를 채운다. build/na는 둘 다 null.
 */
export function validateManualMapping(input: ManualMappingInput, catalog: CatalogSolution[], siblings: readonly MappingRow[]): ManualCheck {
  if (!isVerdict(input.verdict)) return { ok: false, error: "판정은 fulfilled·partial·build·na 중 하나입니다." };
  const verdict = input.verdict;
  if (requiresFeature(verdict)) {
    const featureId = typeof input.featureId === "string" ? input.featureId : "";
    if (!featureId) return { ok: false, error: "충족·부분충족은 기능을 골라야 합니다." };
    const owner = catalog.find((s) => s.features.some((f) => f.id === featureId));
    if (!owner) return { ok: false, error: "카탈로그에 없는 기능입니다." };
    if (typeof input.solutionCode === "string" && input.solutionCode && input.solutionCode !== owner.code) {
      return { ok: false, error: "기능이 선택한 솔루션의 것이 아닙니다." };
    }
    if (siblings.some((s) => !requiresFeature(s.verdict))) {
      return { ok: false, error: "설계·구축영역/해당없음 행이 있는 요구사항에는 충족·부분충족을 추가할 수 없습니다. 그 행을 먼저 지우거나 바꾸세요." };
    }
    if (siblings.some((s) => s.featureId === featureId)) return { ok: false, error: "같은 기능이 이미 매핑돼 있습니다." };
    return { ok: true, verdict, solutionCode: owner.code, featureId };
  }
  if (siblings.length) {
    return {
      ok: false,
      error: siblings.some((s) => requiresFeature(s.verdict))
        ? "설계·구축영역·해당없음은 충족·부분충족과 함께 둘 수 없습니다."
        : "설계·구축영역·해당없음은 요구사항당 하나만 둘 수 있습니다.",
    };
  }
  return { ok: true, verdict, solutionCode: null, featureId: null };
}
