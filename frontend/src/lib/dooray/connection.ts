import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret, parseEncKey } from "@/lib/ms/crypto";
import { DoorayError, doorayRequest, verifyMember } from "./client";

export function doorayConfig() {
  const key = parseEncKey(process.env.DOORAY_TOKEN_ENC_KEY);
  const site = process.env.DOORAY_SITE?.replace(/\/$/, "") ?? "";
  const organizationId = process.env.DOORAY_ORGANIZATION_ID ?? "";
  return key && /^https:\/\/[a-z0-9-]+\.dooray\.com$/.test(site) && /^\d+$/.test(organizationId) ? { key, site, organizationId } : null;
}
const STATUS_COLUMNS = "member_id,account_name,account_email,connected_at";
export async function connectionStatus(admin: SupabaseClient, userId: string) {
  const config = doorayConfig();
  if (!config) return { configured: false, connected: false };
  const { data, error } = await admin.from("dooray_connections").select(STATUS_COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw new DoorayError("Dooray 연결 상태를 확인하지 못했습니다.", 503);
  return { configured: true, connected: !!data, site: config.site, ...(data ? { accountName: data.account_name, email: data.account_email, connectedAt: data.connected_at } : {}) };
}
export async function saveConnection(admin: SupabaseClient, userId: string, token: string) {
  const config = doorayConfig();
  if (!config) throw new DoorayError("회사 Dooray 연결 설정을 준비 중입니다.", 503, "not_configured");
  const member = verifyMember((await doorayRequest(token)("/common/v1/members/me")).result, config.organizationId);
  const saved = await admin.from("dooray_connections").upsert({ user_id: userId, member_id: member.id, organization_id: config.organizationId, account_name: member.name, account_email: member.externalEmailAddress, token_enc: encryptSecret(token, config.key), connected_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (saved.error) throw new DoorayError("Dooray 연결을 저장하지 못했습니다.", 503);
}
export async function loadConnection(admin: SupabaseClient, userId: string) {
  const config = doorayConfig();
  if (!config) return null;
  const { data, error } = await admin.from("dooray_connections").select("token_enc,connected_at,organization_id").eq("user_id", userId).maybeSingle();
  if (error) throw new DoorayError("Dooray 연결을 확인하지 못했습니다.", 503);
  if (!data) return null;
  if (data.organization_id !== config.organizationId) throw new DoorayError("Dooray 계정을 다시 연결해 주세요.", 409, "reconnect");
  let token: string;
  try { token = decryptSecret(data.token_enc, config.key); } catch { throw new DoorayError("Dooray 계정을 다시 연결해 주세요.", 409, "reconnect"); }
  return { token, connectedAt: data.connected_at, site: config.site };
}
