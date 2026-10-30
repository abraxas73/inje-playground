import { NextRequest } from "next/server";
import { createUpdateAppcast, UPDATE_HEADERS } from "@/lib/desktop/update-feed";
import { authorizeUpdate, rejectUpdateMethod, updateError } from "@/lib/desktop/update-request";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const r = await authorizeUpdate(q.get("platform"), q.get("version"));
  if (!r.ok) return r.response;
  if (r.platform === "linux") return updateError(400); // Linux는 appcast 없이 /release?mode=automatic 사용
  return new Response(createUpdateAppcast(r.platform, r.artifact), {
    headers: { ...UPDATE_HEADERS, "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
export const POST = rejectUpdateMethod;
export const PUT = rejectUpdateMethod;
export const PATCH = rejectUpdateMethod;
export const DELETE = rejectUpdateMethod;
export const HEAD = rejectUpdateMethod;
