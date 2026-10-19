import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { DESKTOP_RELEASE_KEY, DESKTOP_VERSION, parseDesktopRelease } from "./release";
import { canAutoUpdate, UPDATE_HEADERS } from "./update-feed";

export const updateError = (status: number) => NextResponse.json({ error: "업데이트를 준비하지 못했습니다. 다시 확인해 주세요." }, { status, headers: UPDATE_HEADERS });
export const rejectUpdateMethod = () => new Response(null, { status: 405, headers: { ...UPDATE_HEADERS, Allow: "GET" } });

export async function authorizeUpdate(platform: string | null, version: string | null) {
  const caller = await requireUser();
  if (!caller.ok) {
    for (const [key, value] of Object.entries(UPDATE_HEADERS)) caller.response.headers.set(key, value);
    return { ok: false as const, response: caller.response };
  }
  if ((platform !== "macos" && platform !== "windows") || !version || !DESKTOP_VERSION.test(version))
    return { ok: false as const, response: updateError(400) };
  const { data, error } = await caller.admin.from("settings").select("value").eq("key", DESKTOP_RELEASE_KEY).maybeSingle();
  if (error) return { ok: false as const, response: updateError(503) };
  const artifact = parseDesktopRelease(data?.value)[platform];
  if (!artifact || !canAutoUpdate(platform, artifact)) return { ok: false as const, response: updateError(404) };
  if (artifact.version !== version) return { ok: false as const, response: updateError(409) };
  return { ok: true, admin: caller.admin, artifact, platform } as const;
}
