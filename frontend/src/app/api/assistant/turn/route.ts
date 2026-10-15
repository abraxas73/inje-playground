import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/assistant/turn — 1.7.0 미만 앱의 예전 이노봇 턴. 1.7.0부터 앱은 /api/chat/turn을 쓴다.
 * Claude를 부르지 않고 업데이트 안내만 돌려준다(예전 앱은 {error} 문구를 대화창에 그대로 보인다). 보급이 끝나면 이 파일을 지운다.
 */
export async function POST() {
  return NextResponse.json(
    { error: "이노봇이 새 버전으로 바뀌었습니다. 이노봇을 계속 쓰려면 앱을 최신 버전으로 업데이트해 주세요. iPhone은 TestFlight에서, Android·Mac·Windows는 https://innocrew.innogrid.com/apps 에서 받을 수 있습니다.", code: "app_update_required" },
    { status: 426, headers: { "Cache-Control": "no-store" } },
  );
}
