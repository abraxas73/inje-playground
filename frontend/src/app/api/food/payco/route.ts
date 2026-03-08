import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { address, distance } = await request.json();

    if (!address) {
      return NextResponse.json({ error: "address is required" }, { status: 400 });
    }

    const res = await fetch(
      "https://bizplus.payco.com/ajax/merchant/map/myMerchants.json",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, distance: distance || 500 }),
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `PAYCO API 응답 오류: ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "PAYCO 가맹점 조회 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
