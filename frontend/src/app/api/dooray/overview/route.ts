import { NextRequest } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { doorayRequest, overview } from "@/lib/dooray/client";
import { loadConnection } from "@/lib/dooray/connection";
import { doorayFailure, doorayJson } from "@/lib/dooray/route";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const c = await loadConnection(auth.admin, auth.userId);
    const empty = { connected: false, events: { items: [] }, mail: { items: [] }, channels: { items: [] } };
    if (!c) return doorayJson(empty);
    const day = request.nextUrl.searchParams.get("date") ?? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(22000)]);
    const appCalendar = request.nextUrl.searchParams.get("calendarSource") === "app";
    const data = await overview(doorayRequest(c.token, signal), day, request.nextUrl.searchParams.get("briefing") === "1", request.nextUrl.searchParams.get("calendar") || undefined, !appCalendar);
    // A concurrent disconnect/reconnect must not return the old account's data.
    const current = await loadConnection(auth.admin, auth.userId);
    if (!current || current.connectedAt !== c.connectedAt || current.token !== c.token) return doorayJson(empty);
    return doorayJson({ connected: true, site: c.site, ...(appCalendar ? { calendarSource: "app" } : {}), ...data });
  } catch (e) { return doorayFailure(e); }
}
