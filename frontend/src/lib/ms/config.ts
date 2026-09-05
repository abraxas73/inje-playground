/**
 * Microsoft 연동 런타임 설정 — Entra 앱은 Teams 멤버 조회와 같은 것을 재사용한다(스펙 §2).
 * settings: teams_tenant_id·teams_graph_client_id / env: TEAMS_GRAPH_CLIENT_SECRET·MS_TOKEN_ENC_KEY
 */
import { loadSettings, type ServerSupabase } from "@/lib/settings-server";
import { ENC_KEY_ENV, parseEncKey } from "./crypto";
import type { MsAppConfig } from "./oauth";

export const MS_SETTING_KEYS = ["teams_tenant_id", "teams_graph_client_id"] as const;

export interface MsRuntimeConfig {
  app: MsAppConfig;
  encKey: Buffer;
}

export type MsConfigResult = { ok: true; config: MsRuntimeConfig } | { ok: false; missing: string[] };

/** 순수: settings 맵 + env → 설정 또는 누락 항목명 목록(순서 고정) */
export function resolveMsConfig(settings: Record<string, string | undefined>, env: Record<string, string | undefined>): MsConfigResult {
  const missing: string[] = [];
  const tenantId = settings.teams_tenant_id?.trim() ?? "";
  if (!tenantId) missing.push("teams_tenant_id");
  const clientId = settings.teams_graph_client_id?.trim() ?? "";
  if (!clientId) missing.push("teams_graph_client_id");
  const clientSecret = env.TEAMS_GRAPH_CLIENT_SECRET?.trim() ?? "";
  if (!clientSecret) missing.push("env TEAMS_GRAPH_CLIENT_SECRET");
  const encKey = parseEncKey(env[ENC_KEY_ENV]);
  if (!encKey) missing.push(`env ${ENC_KEY_ENV}`);
  if (missing.length > 0 || !encKey) return { ok: false, missing };
  return { ok: true, config: { app: { tenantId, clientId, clientSecret }, encKey } };
}

/** 서버 전용: settings 테이블(세션 클라이언트) + process.env */
export async function loadMsConfig(supabase: ServerSupabase, env: Record<string, string | undefined> = process.env): Promise<MsConfigResult> {
  return resolveMsConfig(await loadSettings(supabase, MS_SETTING_KEYS), env);
}

export function missingConfigMessage(missing: string[]): string {
  return `Microsoft 연동 설정이 누락되었습니다: ${missing.join(", ")}`;
}
