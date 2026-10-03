/** 연동 provider 식별자. 기본값은 항상 dooray. */
export type Provider = "dooray" | "teams";

/** 관리자가 독립적으로 선택하는 세 축 */
export type ProviderAxis = "notify" | "memberSource" | "dm";

/** 축 → settings 테이블 key */
export const PROVIDER_SETTING_KEYS: Record<ProviderAxis, string> = {
  notify: "notify_provider",
  memberSource: "member_source_provider",
  dm: "dm_provider",
};

/** Teams 관련 settings key (비밀 아님 — Graph client secret은 env 전용) */
export const TEAMS_SETTING_KEYS = [
  "teams_notify_webhook_url",
  "teams_dm_webhook_url",
  "teams_members_webhook_url",
  "teams_graph_client_id",
  "teams_tenant_id",
  "teams_group_id",
] as const;

/**
 * 비admin 인증 사용자에게 GET /api/settings 응답에서 제외할 키.
 * dooray_token은 브라우저(크롬 확장 브리지)에서 직접 쓰므로 제외 대상이 아니다.
 */
export const ADMIN_ONLY_SETTING_KEYS: ReadonlySet<string> = new Set([
  "dooray_hook_url",
  "teams_notify_webhook_url",
  "teams_dm_webhook_url",
  "teams_members_webhook_url",
]);

export function parseProvider(value: string | null | undefined): Provider {
  return value?.trim().toLowerCase() === "teams" ? "teams" : "dooray";
}

/** 멤버 소스 축은 외부 연동 없이 쓰는 "users"(앱 사용자 명단 = user_profiles)도 허용 */
export type MemberSourceProvider = Provider | "users";

export function parseMemberSourceProvider(value: string | null | undefined): MemberSourceProvider {
  const v = value?.trim().toLowerCase();
  return v === "teams" ? "teams" : v === "users" ? "users" : "dooray";
}

export function resolveProvider(
  settings: Record<string, string | undefined>,
  axis: ProviderAxis
): Provider {
  return parseProvider(settings[PROVIDER_SETTING_KEYS[axis]]);
}
