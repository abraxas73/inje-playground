import { NextResponse } from "next/server";
export const JIRA_APP_RETURN_URL = "innogrid://login-callback?jira_connected=1";
export function jiraMobileComplete() {
  return new NextResponse(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jira 연결 완료</title></head><body style="font-family:system-ui;padding:24px;max-width:480px;margin:40px auto;line-height:1.7"><h1>Jira 계정이 연결되었습니다</h1><p>앱으로 돌아갑니다. 이동하지 않으면 아래 버튼을 눌러 주세요.</p><a href="${JIRA_APP_RETURN_URL}">앱으로 돌아가기</a><p><a href="/settings?jira_connected=1#jira">웹 설정에서 확인</a></p><script>window.location.replace(${JSON.stringify(JIRA_APP_RETURN_URL)});</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
