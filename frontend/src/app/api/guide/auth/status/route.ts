import { NextResponse } from "next/server";
import { nlmFetch } from "@/lib/nlm-service";

export async function GET() {
  try {
    const result = await nlmFetch("/auth/status");
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "인증 상태 확인에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
