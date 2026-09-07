import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOURCE_COLUMNS, type SourceDbRow } from "@/lib/rfp/catalog/store";
import { confluenceConfig, fetchConfluenceVersion } from "@/lib/rfp/catalog/confluence";
import { sourceFreshness, type Freshness } from "@/lib/rfp/catalog/freshness";
import { fetchItemMeta } from "@/lib/ms/graph-drive";
import { graphTokenForRoute } from "@/lib/ms/route-token";

export const runtime = "nodejs";
type Params = { params: Promise<{ code: string }> };

/** 원본을 동시에 몇 개까지 확인할지(Confluence·Graph 부하 제한) */
const CONCURRENCY = 4;

export interface FreshnessRow extends Freshness {
  id: string;
  currentVersion?: number | null;
  currentModifiedAt?: string | null;
}

/**
 * GET /api/admin/rfp-catalog/solutions/[code]/sources/freshness
 * 소스마다 원본의 현재 상태만 읽어(Confluence는 버전, xlsx는 수정 시각) 저장된 값과 비교한 결과를 돌려준다.
 * 본문·파일을 내려받지 않는다. xlsx는 세션 사용자의 Graph 토큰이 필요하며, 없으면 그 행만 "확인 불가"로 표시한다.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const { data, error } = await a.admin.from("rfp_solution_sources").select(SOURCE_COLUMNS).eq("solution_code", code).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const sources = (data ?? []) as SourceDbRow[];
  if (!sources.length) return NextResponse.json({ rows: [] });

  const cfg = confluenceConfig();
  let graphToken: string | null = null;
  let graphError: string | null = null;
  if (sources.some((s) => s.kind === "xlsx")) {
    const tok = await graphTokenForRoute(a.admin, auth.userId);
    if (tok.ok) graphToken = tok.token;
    else graphError = "Microsoft 계정 연결이 필요합니다(설정 화면에서 연결).";
  }

  const rows: FreshnessRow[] = new Array(sources.length);
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const s = sources[next++];
      const base = { kind: s.kind, pageVersion: s.page_version, importedAt: s.imported_at } as const;
      try {
        if (s.kind === "confluence") {
          if (!cfg) {
            rows[sources.indexOf(s)] = { id: s.id, ...sourceFreshness({ ...base, error: "ATLASSIAN_* 환경 변수가 없어 확인할 수 없습니다." }) };
            continue;
          }
          const v = await fetchConfluenceVersion(cfg, s.page_id);
          rows[sources.indexOf(s)] = { id: s.id, currentVersion: v.version, ...sourceFreshness({ ...base, currentVersion: v.version }) };
          continue;
        }
        if (!graphToken || !s.drive_id) {
          rows[sources.indexOf(s)] = { id: s.id, ...sourceFreshness({ ...base, error: graphError ?? "xlsx 소스 정보가 부족합니다. 소스를 다시 등록하세요." }) };
          continue;
        }
        const meta = await fetchItemMeta(graphToken, s.drive_id, s.page_id);
        rows[sources.indexOf(s)] = { id: s.id, currentModifiedAt: meta.lastModifiedAt, ...sourceFreshness({ ...base, currentModifiedAt: meta.lastModifiedAt }) };
      } catch (e) {
        rows[sources.indexOf(s)] = { id: s.id, ...sourceFreshness({ ...base, error: e instanceof Error ? e.message : String(e) }) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker));
  return NextResponse.json({ rows, checkedAt: new Date().toISOString() });
}
