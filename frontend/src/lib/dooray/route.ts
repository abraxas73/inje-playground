import { NextResponse } from "next/server";
import { DoorayError } from "./client";
export const doorayJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export const doorayFailure = (e: unknown) => e instanceof DoorayError ? doorayJson({ error: e.message, code: e.code }, e.status) : doorayJson({ error: "Dooray 요청을 처리하지 못했습니다." }, 502);
