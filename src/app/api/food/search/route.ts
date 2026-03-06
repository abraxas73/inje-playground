import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

// Kakao API pageable_count is capped at 45 per search.
// To get more results, we subdivide the search area into grid cells
// and search each cell separately, then deduplicate.

const KAKAO_PAGE_SIZE = 15;
const KAKAO_MAX_PAGEABLE = 45; // pageable_count cap
const KAKAO_MAX_PAGES = Math.ceil(KAKAO_MAX_PAGEABLE / KAKAO_PAGE_SIZE); // 3

// Approximate meters per degree at mid-latitudes (Korea ~37°N)
const METERS_PER_DEG_LAT = 111_320;
const METERS_PER_DEG_LNG = 88_000; // cos(37°) * 111,320

interface FetchParams {
  kakaoKey: string;
  categoryGroupCode: string;
  keyword: string;
  cx: string;
  cy: string;
  radius: string;
}

async function fetchAllPages(params: FetchParams): Promise<Record<string, unknown>[]> {
  const { kakaoKey, categoryGroupCode, keyword, cx, cy, radius } = params;
  const isKeyword = !!keyword;

  const buildUrl = (page: number) => {
    const base = isKeyword
      ? "https://dapi.kakao.com/v2/local/search/keyword.json"
      : "https://dapi.kakao.com/v2/local/search/category.json";
    const url = new URL(base);
    if (isKeyword) url.searchParams.set("query", keyword);
    url.searchParams.set("category_group_code", categoryGroupCode);
    url.searchParams.set("x", cx);
    url.searchParams.set("y", cy);
    url.searchParams.set("radius", radius);
    url.searchParams.set("page", String(page));
    url.searchParams.set("size", String(KAKAO_PAGE_SIZE));
    url.searchParams.set("sort", "distance");
    return url.toString();
  };

  // Fetch page 1
  const firstRes = await fetch(buildUrl(1), {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
    cache: "no-store",
  });
  if (!firstRes.ok) return [];

  const firstData = await firstRes.json();
  const docs: Record<string, unknown>[] = [...(firstData.documents || [])];
  const isEnd = firstData.meta?.is_end ?? true;

  if (isEnd || KAKAO_MAX_PAGES <= 1) return docs;

  // Fetch remaining pages in parallel
  const pages = Array.from({ length: KAKAO_MAX_PAGES - 1 }, (_, i) => i + 2);
  const results = await Promise.allSettled(
    pages.map((page) =>
      fetch(buildUrl(page), {
        headers: { Authorization: `KakaoAK ${kakaoKey}` },
        cache: "no-store",
      }).then((res) => (res.ok ? res.json() : null))
    )
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value?.documents?.length) {
      docs.push(...result.value.documents);
    }
  }

  return docs;
}

function generateGridCenters(
  cx: number,
  cy: number,
  radiusM: number,
  gridSize: number
): { x: string; y: string; r: string }[] {
  if (gridSize <= 1) {
    return [{ x: String(cx), y: String(cy), r: String(radiusM) }];
  }

  const cellRadius = radiusM / gridSize;
  const step = (radiusM * 2) / gridSize;
  const centers: { x: string; y: string; r: string }[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const offsetX = -radiusM + step * (col + 0.5);
      const offsetY = -radiusM + step * (row + 0.5);
      const newX = cx + offsetX / METERS_PER_DEG_LNG;
      const newY = cy + offsetY / METERS_PER_DEG_LAT;
      // Cell radius with some overlap to avoid gaps
      const r = Math.ceil(cellRadius * 1.42);
      centers.push({ x: String(newX), y: String(newY), r: String(r) });
    }
  }

  return centers;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const x = searchParams.get("x");
  const y = searchParams.get("y");
  const radius = searchParams.get("radius") || "1000";
  const categoryGroupCode = searchParams.get("category_group_code") || "FD6";
  const subCategory = searchParams.get("sub_category") || "";
  const detailCategory = searchParams.get("detail_category") || "";
  const keyword = searchParams.get("keyword") || "";
  const maxResults = Math.min(parseInt(searchParams.get("max_results") || "30"), 250);

  if (!x || !y) {
    return NextResponse.json({ error: "x, y 좌표가 필요합니다" }, { status: 400 });
  }

  const { data: settingsData } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "kakao_rest_api_key")
    .single();

  const kakaoKey = settingsData?.value;
  if (!kakaoKey) {
    return NextResponse.json(
      { error: "설정 페이지에서 Kakao REST API 키를 입력해주세요." },
      { status: 400 }
    );
  }

  // Validate API key with a single request first
  const testUrl = new URL("https://dapi.kakao.com/v2/local/search/category.json");
  testUrl.searchParams.set("category_group_code", categoryGroupCode);
  testUrl.searchParams.set("x", x);
  testUrl.searchParams.set("y", y);
  testUrl.searchParams.set("radius", "100");
  testUrl.searchParams.set("size", "1");
  const testRes = await fetch(testUrl.toString(), {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
    cache: "no-store",
  });
  if (!testRes.ok) {
    const text = await testRes.text();
    return NextResponse.json(
      { error: `Kakao API 오류: ${testRes.status} ${text}` },
      { status: testRes.status }
    );
  }

  // Determine grid size based on how many results we need
  // Each cell can return max 45 results
  // gridSize=1: 1 cell → max 45
  // gridSize=2: 4 cells → max 180
  // gridSize=3: 9 cells → max 405
  const radiusM = parseInt(radius);
  let gridSize = 1;
  if (maxResults > 45) gridSize = 2;
  if (maxResults > 180) gridSize = 3;

  const gridCenters = generateGridCenters(parseFloat(x), parseFloat(y), radiusM, gridSize);

  // Fetch all cells in parallel
  const cellResults = await Promise.allSettled(
    gridCenters.map((cell) =>
      fetchAllPages({
        kakaoKey,
        categoryGroupCode,
        keyword,
        cx: cell.x,
        cy: cell.y,
        radius: cell.r,
      })
    )
  );

  const allDocuments: Record<string, unknown>[] = [];
  for (const result of cellResults) {
    if (result.status === "fulfilled") {
      allDocuments.push(...result.value);
    }
  }

  // Deduplicate by place ID
  const seen = new Set<string>();
  const uniqueDocuments = allDocuments.filter((doc) => {
    const id = doc.id as string;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Sort by distance from original center
  const cx0 = parseFloat(x);
  const cy0 = parseFloat(y);
  uniqueDocuments.sort((a, b) => {
    const distA = parseFloat(a.distance as string) || calcDist(cx0, cy0, a);
    const distB = parseFloat(b.distance as string) || calcDist(cx0, cy0, b);
    return distA - distB;
  });

  // Auto-collect sub & detail categories from results into DB
  if (uniqueDocuments.length) {
    const groupName = categoryGroupCode === "CE7" ? "카페" : "음식점";
    const subCats = new Set<string>();
    const detailCats: { sub: string; detail: string }[] = [];

    for (const doc of uniqueDocuments) {
      const parts = (doc.category_name as string).split(" > ");
      if (parts.length >= 2) subCats.add(parts[1]);
      if (parts.length >= 3) detailCats.push({ sub: parts[1], detail: parts[2] });
    }

    if (subCats.size > 0) {
      const rows = [...subCats].map((sc) => ({
        category_group_code: categoryGroupCode,
        category_group_name: groupName,
        sub_category: sc,
      }));
      supabase
        .from("food_categories")
        .upsert(rows, { onConflict: "category_group_code,sub_category" })
        .then(() => {});
    }

    if (detailCats.length > 0) {
      const uniqueDetails = new Map<string, { sub: string; detail: string }>();
      for (const d of detailCats) {
        uniqueDetails.set(`${d.sub}::${d.detail}`, d);
      }
      const detailRows = [...uniqueDetails.values()].map((d) => ({
        category_group_code: categoryGroupCode,
        sub_category: d.sub,
        detail_category: d.detail,
      }));
      supabase
        .from("food_detail_categories")
        .upsert(detailRows, { onConflict: "category_group_code,sub_category,detail_category" })
        .then(() => {});
    }
  }

  // Filter by subcategory / detail category
  let filtered = uniqueDocuments;
  if (subCategory) {
    filtered = filtered.filter((doc) => {
      const parts = (doc.category_name as string).split(" > ");
      return parts.length >= 2 && parts[1] === subCategory;
    });
  }
  if (detailCategory) {
    filtered = filtered.filter((doc) => {
      const parts = (doc.category_name as string).split(" > ");
      return parts.length >= 3 && parts[2] === detailCategory;
    });
  }

  return NextResponse.json({
    documents: filtered.slice(0, maxResults),
    meta: {
      total_count: filtered.length,
      is_end: filtered.length <= maxResults,
    },
  });
}

function calcDist(cx: number, cy: number, doc: Record<string, unknown>): number {
  const dx = (parseFloat(doc.x as string) - cx) * METERS_PER_DEG_LNG;
  const dy = (parseFloat(doc.y as string) - cy) * METERS_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}
