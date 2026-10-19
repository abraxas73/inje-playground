import { NextResponse } from "next/server";

/** 설치된 앱에 등록된 주소. 인증 코드·토큰·외부 입력은 딥링크에 넣지 않는다. */
export const MS_APP_RETURN_URL = "innogrid://login-callback?ms_connected=1";

export function mobileConnectionComplete(): NextResponse {
  return new NextResponse(null, {
    status: 302,
    headers: { Location: MS_APP_RETURN_URL, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
