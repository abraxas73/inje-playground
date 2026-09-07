/**
 * 개인 SharePoint 업로드 기본 폴더(user_settings). 프로젝트에 폴더가 지정돼 있지 않으면
 * 업로드가 이 폴더를 쓴다 — 사람마다 자기 사이트·폴더가 다르므로 전역 설정으로 두지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSharepointFolder } from "./mappers";
import type { SharepointFolder } from "@/types/rfp";

export const USER_SHAREPOINT_FOLDER_KEY = "rfp_sharepoint_folder";

/** 값이 깨져 있으면(수동 편집·구버전) null로 본다 — 업로드는 "폴더 미지정" 안내로 이어진다 */
export async function loadUserDefaultFolder(admin: SupabaseClient, userId: string): Promise<SharepointFolder | null> {
  const { data } = await admin
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", USER_SHAREPOINT_FOLDER_KEY)
    .maybeSingle();
  const raw = (data as { value?: string } | null)?.value;
  if (!raw) return null;
  try {
    return parseSharepointFolder(JSON.parse(raw));
  } catch {
    return null;
  }
}
