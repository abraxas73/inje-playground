import { NextResponse } from "next/server";

/** 설치된 앱에 등록된 주소. 인증 코드·토큰·외부 입력은 딥링크에 넣지 않는다. */
export const MS_APP_RETURN_URL = "innogrid://login-callback?ms_connected=1";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * 앱 흐름(외부 브라우저)에서 연결이 실패했을 때 — 웹 /settings로 보내면 그 브라우저엔 웹 세션이 없어 로그인 화면으로 튕기고 이유가 사라진다.
 * 이유를 보여 주고 앱으로만 돌려보낸다(자동 이동 없음 — 읽을 시간). 문구에는 Azure error 값이 섞일 수 있어 이스케이프한다.
 */
export function mobileConnectionFailed(message: string): NextResponse {
  return new NextResponse(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Microsoft 연결 실패</title></head><body style="font-family:system-ui;padding:24px;max-width:480px;margin:40px auto;line-height:1.7"><h1>Microsoft 계정을 연결하지 못했습니다</h1><p>${escapeHtml(message)}</p><p>회사 설정에 따라 관리자 승인 화면이 나왔다면 IT 담당자에게 승인을 요청한 뒤 다시 연결해 주세요.</p><a href="innogrid://login-callback" style="display:inline-block;padding:12px 20px;background:#0441ff;color:white;border-radius:12px;text-decoration:none;font-weight:700">앱으로 돌아가기</a></body></html>`, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export function mobileConnectionComplete(): NextResponse {
  return new NextResponse(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Microsoft 연결 완료</title></head><body style="font-family:system-ui;padding:24px;max-width:480px;margin:40px auto;line-height:1.7"><h1>Microsoft 계정이 연결되었습니다</h1><p>INNOGRID 앱으로 돌아갑니다. 자동으로 열리지 않으면 아래 버튼을 눌러 주세요.</p><a href="${MS_APP_RETURN_URL}" style="display:inline-block;padding:12px 20px;background:#0441ff;color:white;border-radius:12px;text-decoration:none;font-weight:700">앱으로 돌아가기</a><script>window.location.replace(${JSON.stringify(MS_APP_RETURN_URL)});</script></body></html>`, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
