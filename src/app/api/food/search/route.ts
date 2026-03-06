import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

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

  // Get Kakao API key from settings
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

  // Kakao API: max size=15, max page=45 (675 results total)
  // When sub/detail category filters are active, we need more raw results
  // because filtering happens server-side after fetching
  const hasFilter = !!(subCategory || detailCategory);
  const pagesToFetch = hasFilter
    ? 45 // fetch max to maximize filtered results
    : Math.ceil(maxResults / 15);

  const isKeywordSearch = !!keyword;

  const buildUrl = (page: number) => {
    if (isKeywordSearch) {
      const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
      url.searchParams.set("query", keyword);
      url.searchParams.set("category_group_code", categoryGroupCode);
      url.searchParams.set("x", x);
      url.searchParams.set("y", y);
      url.searchParams.set("radius", radius);
      url.searchParams.set("page", String(page));
      url.searchParams.set("size", "15");
      url.searchParams.set("sort", "distance");
      return url.toString();
    }
    const url = new URL("https://dapi.kakao.com/v2/local/search/category.json");
    url.searchParams.set("category_group_code", categoryGroupCode);
    url.searchParams.set("x", x);
    url.searchParams.set("y", y);
    url.searchParams.set("radius", radius);
    url.searchParams.set("page", String(page));
    url.searchParams.set("size", "15");
    url.searchParams.set("sort", "distance");
    return url.toString();
  };

  // First page to validate API key and check total
  const firstRes = await fetch(buildUrl(1), {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
    cache: "no-store",
  });

  if (!firstRes.ok) {
    const text = await firstRes.text();
    return NextResponse.json(
      { error: `Kakao API 오류: ${firstRes.status} ${text}` },
      { status: firstRes.status }
    );
  }

  const firstData = await firstRes.json();
  const allDocuments: Record<string, unknown>[] = [...(firstData.documents || [])];
  let isEnd = firstData.meta?.is_end ?? true;

  // Fetch remaining pages in parallel batches
  if (!isEnd && pagesToFetch > 1) {
    const BATCH_SIZE = 10;
    for (let batchStart = 2; batchStart <= pagesToFetch && !isEnd; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, pagesToFetch);
      const pages = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);

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
          allDocuments.push(...result.value.documents);
          if (result.value.meta?.is_end) isEnd = true;
        }
      }

      // If no filter, stop when we have enough raw results
      if (!hasFilter && allDocuments.length >= maxResults) break;
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

  // Auto-collect sub & detail categories from results into DB
  if (uniqueDocuments.length) {
    const groupName = categoryGroupCode === "CE7" ? "카페" : "음식점";
    const subCats = new Set<string>();
    const detailCats: { sub: string; detail: string }[] = [];

    for (const doc of uniqueDocuments) {
      const parts = (doc.category_name as string).split(" > ");
      if (parts.length >= 2) {
        subCats.add(parts[1]);
      }
      if (parts.length >= 3) {
        detailCats.push({ sub: parts[1], detail: parts[2] });
      }
    }

    // Fire-and-forget upserts
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
      is_end: isEnd || filtered.length <= maxResults,
    },
  });
}
