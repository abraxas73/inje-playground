import { NextRequest, NextResponse } from "next/server";

const DOORAY_API_BASE = "https://api.dooray.com";

/** GET /api/dooray/projects — Dooray 프로젝트 목록 조회 */
export async function GET(request: NextRequest) {
  const token = request.headers.get("x-dooray-token");

  if (!token) {
    return NextResponse.json(
      { error: "토큰이 필요합니다." },
      { status: 400 }
    );
  }

  const headers = {
    Authorization: `dooray-api ${token}`,
    "Content-Type": "application/json",
  };

  try {
    const projects: { id: string; code: string; name: string; description: string; state: string }[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(
        `${DOORAY_API_BASE}/project/v1/projects?page=${page}&size=100`,
        { headers }
      );

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json(
          { error: `Dooray API 오류 (${res.status}): ${text}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      const result = data.result ?? [];

      for (const p of result) {
        // Strip HTML tags and truncate description
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

    // Filter active projects only
    const active = projects.filter(
      (p) => p.state === "active" || p.state === ""
    );

    return NextResponse.json({ projects: active });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "프로젝트 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
