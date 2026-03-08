import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

/** GET /api/food/reverse-geocode?x=경도&y=위도 — 좌표 → 주소 변환 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const x = searchParams.get("x");
  const y = searchParams.get("y");

  if (!x || !y) {
    return NextResponse.json({ error: "x, y 좌표가 필요합니다." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: settingsData } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "kakao_rest_api_key")
    .single();

  const kakaoKey = settingsData?.value;
  if (!kakaoKey) {
    return NextResponse.json({ address: null });
  }

  const url = new URL("https://dapi.kakao.com/v2/local/geo/coord2address.json");
  url.searchParams.set("x", x);
  url.searchParams.set("y", y);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });

  if (!res.ok) {
    return NextResponse.json({ address: null });
  }

  const data = await res.json();
  const doc = data.documents?.[0];
  const address =
    doc?.road_address?.address_name ||
    doc?.address?.address_name ||
    null;

  return NextResponse.json({ address });
}
