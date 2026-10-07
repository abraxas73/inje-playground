import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { runPrivacyReport } from "@/lib/jira/privacy";
import { jiraJson, jiraFailure } from "@/lib/jira/route";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || ""), expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return jiraJson({ error:"Unauthorized" },401);
  const admin = adminClientOr500(); if (!admin.ok) return admin.response;
  try { return jiraJson(await runPrivacyReport(admin.admin)); } catch (e) { return jiraFailure(e); }
}
