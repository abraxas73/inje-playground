import { NextResponse } from "next/server";

/** 설치된 앱에 등록된 주소. 인증 코드·토큰·외부 입력은 딥링크에 넣지 않는다. */
export const MS_APP_RETURN_URL = "innogrid://login-callback?ms_connected=1";

export function mobileConnectionComplete(): NextResponse {
  return new NextResponse(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Microsoft 연결 완료</title></head><body style="font-family:system-ui;padding:24px;max-width:480px;margin:40px auto;line-height:1.7"><h1>Microsoft 계정이 연결되었습니다</h1><p>INNOGRID 앱으로 돌아갑니다. 자동으로 열리지 않으면 아래 버튼을 눌러 주세요.</p><a href="${MS_APP_RETURN_URL}" style="display:inline-block;padding:12px 20px;background:#0441ff;color:white;border-radius:12px;text-decoration:none;font-weight:700">앱으로 돌아가기</a><script>window.location.replace(${JSON.stringify(MS_APP_RETURN_URL)});</script></body></html>`, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
