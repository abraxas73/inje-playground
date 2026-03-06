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
  const page = searchParams.get("page") || "1";
  const subCategory = searchParams.get("sub_category") || "";

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

  const url = new URL("https://dapi.kakao.com/v2/local/search/category.json");
  url.searchParams.set("category_group_code", categoryGroupCode);
  url.searchParams.set("x", x);
  url.searchParams.set("y", y);
  url.searchParams.set("radius", radius);
  url.searchParams.set("page", page);
  url.searchParams.set("size", "15");
  url.searchParams.set("sort", "distance");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Kakao API 오류: ${res.status} ${text}` },
      { status: res.status }
    );
  }

  const data = await res.json();

  // Auto-collect subcategories from results into DB
  if (data.documents?.length) {
    const groupName = categoryGroupCode === "CE7" ? "카페" : "음식점";
    const subCats = new Set<string>();
    for (const doc of data.documents) {
      const parts = (doc.category_name as string).split(" > ");
      if (parts.length >= 2) {
        subCats.add(parts[1]);
      }
    }
    if (subCats.size > 0) {
      const rows = [...subCats].map((sc) => ({
        category_group_code: categoryGroupCode,
        category_group_name: groupName,
        sub_category: sc,
      }));
      // fire-and-forget upsert
      supabase
        .from("food_categories")
        .upsert(rows, { onConflict: "category_group_code,sub_category" })
        .then(() => {});
    }

    // Filter by subcategory if specified
    if (subCategory) {
      data.documents = data.documents.filter((doc: { category_name: string }) => {
        const parts = doc.category_name.split(" > ");
        return parts.length >= 2 && parts[1] === subCategory;
      });
    }
  }

  return NextResponse.json(data);
}
