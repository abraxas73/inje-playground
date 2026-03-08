import type { DoorayMember } from "@/types/dooray";

const DOORAY_API_BASE = "https://api.dooray.com";

async function fetchMemberDetail(
  token: string,
  memberId: string
): Promise<{ id: string; name: string }> {
  const res = await fetch(
    `${DOORAY_API_BASE}/common/v1/members/${memberId}`,
    {
      headers: {
        Authorization: `dooray-api ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    return { id: memberId, name: "이름 없음" };
  }

  const data = await res.json();
  const result = data.result || {};
  return {
    id: result.id || memberId,
    name: result.name || "이름 없음",
  };
}

export async function fetchProjectMembers(
  token: string,
  projectId: string
): Promise<DoorayMember[]> {
  // 1. Get all member IDs from project
  const memberIds: string[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(
      `${DOORAY_API_BASE}/project/v1/projects/${projectId}/members?page=${page}&size=100`,
      {
        headers: {
          Authorization: `dooray-api ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dooray API 오류 (${res.status}): ${text}`);
    }

    const data = await res.json();
    const result = data.result || [];

    for (const member of result) {
      memberIds.push(member.organizationMemberId);
    }

    hasMore = result.length === 100;
    page++;
  }

  // 2. Fetch member details in parallel (batch of 10)
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
