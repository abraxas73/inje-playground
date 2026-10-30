import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { LINUX_FAILURE_REASONS } from "@/lib/desktop/release";

export const runtime = "nodejs";

/** Windows 설치 단계 이름(mobile/windows/runner/desktop_updater.cpp PostFailure, 앱 nativeFailureReasons와 같게) */
const REASONS = new Set(["file", "arguments", "name", "version", "session", "launch"]);
const LINUX_REASONS = new Set<string>(LINUX_FAILURE_REASONS);
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const int = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/**
 * POST /api/desktop/update-failure {platform, version, reason, winError, attempts}
 * 데스크톱 자동 업데이트의 설치 단계 실패를 감사 로그(category desktop)에 남긴다 — 정해진 값만, 경로·토큰 없음.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const linux = b?.platform === "linux";
  // Linux는 winError 자리에 종료 코드 또는 HTTP 상태(0~999)를 받는다
  if (!b || (b.platform !== "windows" && b.platform !== "macos" && !linux) || typeof b.version !== "string" || !VERSION.test(b.version) ||
      typeof b.reason !== "string" || !(linux ? LINUX_REASONS : REASONS).has(b.reason) ||
      !int(b.winError, 0, linux ? 999 : 0xffffffff) || !int(b.attempts, 1, 10)) {
    return NextResponse.json({ error: "잘못된 업데이트 실패 보고입니다." }, { status: 400 });
  }
  await logAudit(auth.admin, request, {
    userId: auth.userId, action: "데스크톱 업데이트 실패", category: "desktop",
    detail: { platform: b.platform, version: b.version, reason: b.reason, winError: b.winError, attempts: b.attempts },
  });
  return NextResponse.json({ ok: true });
}
