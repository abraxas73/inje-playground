/**
 * 카탈로그 소스가 최신인지 판정한다. 가져오기는 스냅샷이라(외부 문서를 그때 한 번 읽어 DB에 저장) 원본이 바뀌면
 * 관리자가 다시 가져와야 한다 — 그 시점을 화면에서 알 수 있게 원본의 현재 상태와 저장된 값을 비교한다. 순수 함수.
 *
 * - confluence: 저장된 `page_version`과 현재 페이지 버전을 비교한다(본문은 읽지 않는다).
 * - xlsx: 파일의 마지막 수정 시각과 우리가 가져온 시각을 비교한다(버전 번호가 없다).
 */

export type FreshnessState = "fresh" | "stale" | "never" | "unknown";

export interface FreshnessInput {
  kind: "confluence" | "xlsx";
  /** 저장된 페이지 버전(confluence) */
  pageVersion?: number | null;
  /** 마지막으로 가져온 시각 */
  importedAt?: string | null;
  /** 원본의 현재 버전(confluence) */
  currentVersion?: number | null;
  /** 원본의 마지막 수정 시각 ISO(xlsx) */
  currentModifiedAt?: string | null;
  /** 확인 실패 사유(권한·삭제·env 없음 등) */
  error?: string | null;
}

export interface Freshness {
  state: FreshnessState;
  /** 화면 배지 문구 */
  label: string;
  /** 툴팁(자세한 이유) */
  detail: string;
}

const fmt = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ko-KR");
};

export function sourceFreshness(input: FreshnessInput): Freshness {
  if (input.error) return { state: "unknown", label: "확인 불가", detail: input.error };
  if (!input.importedAt) return { state: "never", label: "가져오기 필요", detail: "아직 한 번도 가져오지 않았습니다." };

  if (input.kind === "confluence") {
    const current = input.currentVersion;
    if (current == null || !Number.isFinite(current) || current <= 0) {
      return { state: "unknown", label: "확인 불가", detail: "원본 페이지 버전을 읽지 못했습니다." };
    }
    const saved = Number(input.pageVersion ?? 0);
    if (!saved) return { state: "unknown", label: "확인 불가", detail: `저장된 버전이 없습니다(원본 v${current}). 다시 가져오면 기록됩니다.` };
    if (current > saved) return { state: "stale", label: "갱신 필요", detail: `원본이 v${current}, 가져온 것은 v${saved}입니다. 다시 가져오세요.` };
    return { state: "fresh", label: "최신", detail: `원본과 같은 버전(v${saved})입니다. ${fmt(input.importedAt)}에 가져왔습니다.` };
  }

  const modified = input.currentModifiedAt;
  if (!modified) return { state: "unknown", label: "확인 불가", detail: "파일의 수정 시각을 읽지 못했습니다." };
  const m = Date.parse(modified);
  const i = Date.parse(input.importedAt);
  if (Number.isNaN(m) || Number.isNaN(i)) return { state: "unknown", label: "확인 불가", detail: "시각을 해석할 수 없습니다." };
  if (m > i) return { state: "stale", label: "갱신 필요", detail: `파일이 ${fmt(modified)}에 수정됐고 가져온 것은 ${fmt(input.importedAt)}입니다. 다시 가져오세요.` };
  return { state: "fresh", label: "최신", detail: `가져온 뒤(${fmt(input.importedAt)}) 파일이 바뀌지 않았습니다.` };
}
