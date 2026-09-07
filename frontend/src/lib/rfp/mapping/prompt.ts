import type { CatalogSolution } from "./types";
import { truncateDetails, type ChunkRequirement } from "./chunk";
import { parseDetailUnits } from "./detail-items";

/** 프롬프트 별칭 → 실제 id. 한 실행 안에서만 유효(스펙 §4.3). */
export interface CatalogAliases {
  /** "S1" → 솔루션 code */
  solutions: Map<string, string>;
  /** "F3" → 기능 id와 그 솔루션 code */
  features: Map<string, { featureId: string; solutionCode: string }>;
}

/** 시스템 블록 1(고정, 캐싱 대상 아님) */
export const MAPPING_RULES_PROMPT = `당신은 공공 정보화 사업 제안요청서(RFP)의 요구사항을 당사 솔루션 기능에 매핑하는 프리세일즈 분석가입니다.
카탈로그(시스템 메시지의 두 번째 블록)에는 솔루션(S1, S2 …)과 그 기능(F1, F2 …)이 별칭과 함께 나열돼 있습니다.
요구사항마다 아래 판정 중 하나 이상을 내립니다.
- fulfilled(충족): 카탈로그의 기능이 요구를 그대로 만족한다. feature에 그 기능 별칭을 씁니다.
- partial(부분충족): 기능이 요구의 일부만 만족하고 나머지는 설정·개발이 필요하다. feature 필수.
- build(설계·구축영역): 당사 솔루션 기능이 아닌 SI 설계·구축 작업이다(데이터 이관, 기관 시스템 연계 개발 등). feature는 null.
- na(해당없음): 사업 관리·제약 조건·산출물·교육 등 솔루션과 무관하다. feature는 null.
규칙:
1. 요구를 만족하는 기능이 여러 개면 각각 한 행씩 모두 나열합니다(fulfilled/partial은 여러 행 가능).
2. build/na는 요구사항당 한 행만, 그리고 fulfilled/partial과 함께 쓰지 않습니다.
3. 억지로 맞추지 않습니다. 맞는 기능이 없으면 build 또는 na입니다.
4. feature에는 카탈로그에 있는 별칭(F숫자)만 씁니다. 없는 별칭을 만들지 않습니다.
5. rationale은 왜 그 판정인지 한국어 2문장 이내로 씁니다.
6. 입력에 있는 모든 요구사항에 대해 최소 한 행을 냅니다. reqId는 입력에 적힌 그대로 씁니다.
7. 요구사항에 "세부 항목" 목록이 있으면 **항목마다** 판정을 내고 detail에 그 번호를 씁니다(예: "2"). 항목 구분 없이 요구사항 전체에 대한 판정이면 detail은 null입니다. 세부 항목 목록이 없으면 detail은 항상 null입니다.
8. evidence에는 그 판정을 뒷받침하는 카탈로그 기능 설명의 문장을 그대로 한 문장 인용합니다(없으면 null). 새로 쓰지 않습니다.
결과는 스키마에 맞는 JSON만 출력합니다.`;

/**
 * 시스템 블록 2(카탈로그, cache_control 대상). 활성 솔루션의 활성 기능만 넣고 S/F 별칭 표를 만든다.
 * 활성 기능이 하나도 없는 솔루션은 fulfilled/partial 대상이 될 수 없으므로 넣지 않는다.
 */
export function buildCatalogPrompt(catalog: CatalogSolution[]): { systemText: string; aliases: CatalogAliases } {
  const aliases: CatalogAliases = { solutions: new Map(), features: new Map() };
  const lines: string[] = ["# 당사 솔루션 카탈로그"];
  let s = 0;
  let f = 0;
  for (const sol of catalog) {
    if (!sol.isActive) continue;
    const active = sol.features.filter((x) => x.isActive);
    if (!active.length) continue;
    s += 1;
    const sAlias = `S${s}`;
    aliases.solutions.set(sAlias, sol.code);
    lines.push("", `## ${sAlias}. ${sol.name}`, sol.description.trim() || "(설명 없음)");
    for (const feat of active) {
      f += 1;
      const fAlias = `F${f}`;
      aliases.features.set(fAlias, { featureId: feat.id, solutionCode: sol.code });
      lines.push(`- ${fAlias} ${feat.name}: ${feat.description.trim().replace(/\s+/g, " ") || "(설명 없음)"}`);
    }
  }
  return { systemText: lines.join("\n"), aliases };
}

/**
 * 청크 하나의 사용자 메시지. 세부 내용이 목록이면 1단 항목을 번호와 함께 나열해(2depth는 하위 줄을 묶어)
 * 항목별 판정(detail)을 받을 수 있게 한다.
 */
export function buildChunkMessage(reqs: readonly ChunkRequirement[]): string {
  const parts = reqs.map((r) => {
    const { units, flat } = parseDetailUnits(r.details);
    const lines = [
      `### ${r.reqId} ${r.title.trim()}`,
      `구분: ${r.categoryName.trim()}`,
      `정의: ${r.definition.trim() || "(없음)"}`,
    ];
    if (!flat && units.length > 1) {
      lines.push(`세부 항목 ${units.length}개 — 항목마다 detail에 번호를 쓰세요:`);
      for (const u of units) lines.push(`[${u.key}] ${truncateDetails(u.text, 600)}`);
    } else {
      lines.push(`세부 내용: ${truncateDetails(r.details) || "(없음)"}`);
    }
    return lines.join("\n");
  });
  return `다음 요구사항 ${reqs.length}건을 카탈로그 기능에 매핑하세요.\n\n${parts.join("\n\n")}`;
}
