import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query");

  if (!query) {
    return NextResponse.json({ error: "검색어가 필요합니다" }, { status: 400 });
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

  // Try address search first
  const addressUrl = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  addressUrl.searchParams.set("query", query);
  addressUrl.searchParams.set("size", "10");

  const addressRes = await fetch(addressUrl.toString(), {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });

  if (!addressRes.ok) {
    const text = await addressRes.text();
    return NextResponse.json(
      { error: `Kakao API 오류: ${addressRes.status} ${text}` },
      { status: addressRes.status }
    );
  }

  const addressData = await addressRes.json();

  // Also try keyword search for places like building names
  const keywordUrl = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  keywordUrl.searchParams.set("query", query);
  keywordUrl.searchParams.set("size", "10");

  const keywordRes = await fetch(keywordUrl.toString(), {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });

  const keywordData = keywordRes.ok ? await keywordRes.json() : { documents: [] };

  // Normalize results into a common format
  interface GeoResult {
    address: string;
    road_address: string;
    x: string;
    y: string;
    type: "address" | "place";
    place_name?: string;
  }

  const results: GeoResult[] = [];

  // Address results
  for (const doc of addressData.documents || []) {
    results.push({
      address: doc.address?.address_name || doc.address_name,
      road_address: doc.road_address?.address_name || "",
      x: doc.x,
      y: doc.y,
      type: "address",
    });
  }

  // Keyword results (places)
  for (const doc of keywordData.documents || []) {
    results.push({
      address: doc.address_name,
      road_address: doc.road_address_name || "",
      x: doc.x,
      y: doc.y,
      type: "place",
      place_name: doc.place_name,
    });
  }

  return NextResponse.json(results);
}
