import { NextResponse } from "next/server";

/** OAuth navigation is a document, including when session/permission checks fail. */
export function oauthNotice(message: string, status = 400) {
  const text = message.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return new NextResponse(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>계정 연결 안내</title></head><body style="font-family:system-ui;padding:24px;max-width:480px;margin:40px auto;line-height:1.7"><h1>계정 연결을 완료하지 못했습니다</h1><p>${text}</p><p>앱은 최신 버전으로 업데이트한 뒤 설정에서 다시 연결해 주세요. 웹에서는 이 브라우저에 로그인한 뒤 다시 연결해 주세요.</p><p><a href="/apps">앱 업데이트 안내</a></p><p><a href="/settings">설정으로 이동</a></p><p><a href="innogrid://login-callback">앱으로 돌아가기</a></p></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

export function isOAuthNavigation(path: string, method: string) {
  return method === "GET" && /^\/api\/(jira|ms)\/(connect|callback)$/.test(path);
}
