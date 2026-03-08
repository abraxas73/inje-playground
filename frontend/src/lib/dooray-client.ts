/**
 * 브라우저에서 직접 Dooray API를 호출하는 클라이언트
 * Chrome 확장 프로그램(Inje Chrome Extension)이 CORS 헤더를 추가해줌
 * 확장 미설치 또는 사외망일 경우 DB fallback으로 동작
 */
import type { DoorayMember } from "@/types/dooray";

const DOORAY_API_BASE = "https://api.dooray.com";

function doorayHeaders(token: string) {
  return {
    Authorization: `dooray-api ${token}`,
    "Content-Type": "application/json",
  };
}

async function fetchMemberDetail(
  token: string,
  memberId: string
): Promise<{ id: string; name: string }> {
  try {
    const res = await fetch(
      `${DOORAY_API_BASE}/common/v1/members/${memberId}`,
      { headers: doorayHeaders(token) }
    );
    if (!res.ok) return { id: memberId, name: "이름 없음" };
    const data = await res.json();
    const result = data.result || {};
    return {
      id: result.id || memberId,
      name: result.name || "이름 없음",
    };
  } catch {
    return { id: memberId, name: "이름 없음" };
  }
}

/** 프로젝트 구성원 목록 조회 (브라우저에서 직접 호출) */
export async function fetchProjectMembers(
  token: string,
  projectId: string
): Promise<DoorayMember[]> {
  const memberIds: string[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(
      `${DOORAY_API_BASE}/project/v1/projects/${projectId}/members?page=${page}&size=100`,
      { headers: doorayHeaders(token) }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dooray API 오류 (${res.status}): ${text}`);
    }
    const data = await res.json();
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

/** 프로젝트 목록 조회 (브라우저에서 직접 호출) */
export async function fetchProjects(
  token: string
): Promise<{ id: string; code: string; name: string; description: string }[]> {
  const projects: { id: string; code: string; name: string; description: string; state: string }[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(
      `${DOORAY_API_BASE}/project/v1/projects?page=${page}&size=100`,
      { headers: doorayHeaders(token) }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dooray API 오류 (${res.status}): ${text}`);
    }
    const data = await res.json();
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
