/**
 * 브라우저에서 Dooray API를 호출하는 클라이언트
 * Chrome 확장(Inje Extension)의 background worker가 프록시하여 CORS 우회
 * 확장 미설치 시 에러 → fallback (DB 캐시) 사용
 */
import type { DoorayMember } from "@/types/dooray";

const DOORAY_API_BASE = "https://api.dooray.com";

/** Chrome 확장 브릿지를 통한 fetch */
function doorayFetch(url: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("Chrome 확장 프로그램이 응답하지 않습니다. 확장을 확인해주세요."));
    }, 30000);

    function handler(event: MessageEvent) {
      if (event.data?.type !== "DOORAY_API_RESPONSE" || event.data.id !== id) return;
      window.removeEventListener("message", handler);
      clearTimeout(timeout);
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.data);
      }
    }

    window.addEventListener("message", handler);
    window.postMessage({
      type: "DOORAY_API_REQUEST",
      id,
      url,
      headers: {
        Authorization: `dooray-api ${token}`,
        "Content-Type": "application/json",
      },
    }, "*");
  });
}

async function fetchMemberDetail(
  token: string,
  memberId: string
): Promise<{ id: string; name: string }> {
  try {
    const data = await doorayFetch(
      `${DOORAY_API_BASE}/common/v1/members/${memberId}`,
      token
    ) as { result?: { id?: string; name?: string } };
    const result = data.result || {};
    return {
      id: result.id || memberId,
      name: result.name || "이름 없음",
    };
  } catch {
    return { id: memberId, name: "이름 없음" };
  }
}

/** 프로젝트 구성원 목록 조회 */
export async function fetchProjectMembers(
  token: string,
  projectId: string
): Promise<DoorayMember[]> {
  const memberIds: string[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await doorayFetch(
      `${DOORAY_API_BASE}/project/v1/projects/${projectId}/members?page=${page}&size=100`,
      token
    ) as { result?: { organizationMemberId: string }[] };
    const result = data.result || [];
    for (const m of result) {
      memberIds.push(m.organizationMemberId);
    }
    hasMore = result.length === 100;
    page++;
  }

  const members: DoorayMember[] = [];
  const batchSize = 10;
  for (let i = 0; i < memberIds.length; i += batchSize) {
    const batch = memberIds.slice(i, i + batchSize);
    const details = await Promise.all(
      batch.map((id) => fetchMemberDetail(token, id))
    );
    members.push(...details);
  }

  return members.filter((m) => m.name !== "이름 없음");
}

/** 프로젝트 목록 조회 */
export async function fetchProjects(
  token: string
): Promise<{ id: string; code: string; name: string; description: string }[]> {
  const projects: { id: string; code: string; name: string; description: string; state: string }[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await doorayFetch(
      `${DOORAY_API_BASE}/project/v1/projects?page=${page}&size=100`,
      token
    ) as { result?: { id: string; code?: string; description?: string; state?: string }[] };
    const result = data.result ?? [];
    for (const p of result) {
      const rawDesc = (p.description ?? "").replace(/<[^>]*>/g, "").trim();
      const description = rawDesc.length > 100 ? rawDesc.slice(0, 100) + "…" : rawDesc;
      projects.push({
        id: p.id,
        code: p.code ?? "",
        name: p.code ?? p.id,
        description,
        state: p.state ?? "",
      });
    }
    hasMore = result.length === 100;
    page++;
  }

  return projects.filter((p) => p.state === "active" || p.state === "");
}
