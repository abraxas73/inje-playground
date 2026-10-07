import { NextResponse } from "next/server";
import { JiraError } from "./client";
export const jiraJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export function jiraFailure(error: unknown) {
  return error instanceof JiraError ? jiraJson({ error: error.message, code: error.code }, error.status) : jiraJson({ error: "Jira 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요." }, 502);
}
