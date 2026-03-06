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
  return NextResponse.json(data);
}
