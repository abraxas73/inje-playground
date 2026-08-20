"use client";

import { useState, useEffect, useCallback } from "react";
import { logAction } from "@/lib/action-log";

/** 관리자 전역 설정 키 전체(settings 테이블). 추가 시 여기만 수정. */
export const SETTING_KEYS = [
  // Dooray
  "dooray_token",
  "dooray_project_id",
  "dooray_messenger_url",
  "dooray_hook_url",
  // Kakao
  "kakao_rest_api_key",
  // Provider 선택(축별)
  "notify_provider",
  "member_source_provider",
  "dm_provider",
  // Teams (비밀 아님 — Graph secret은 env TEAMS_GRAPH_CLIENT_SECRET)
  "teams_notify_webhook_url",
  "teams_dm_webhook_url",
  "teams_graph_client_id",
  "teams_tenant_id",
  "teams_group_id",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
export type Settings = Record<SettingKey, string>;

export const DEFAULT_SETTINGS: Settings = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, ""])
) as Settings;

function pickSettings(data: Record<string, unknown>): Settings {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of SETTING_KEYS) {
    const v = data[k];
    out[k] = typeof v === "string" ? v : "";
  }
  return out;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        const loaded = pickSettings(data ?? {});
        setSettings(loaded);
        setSavedSettings(loaded);
      })
      .catch(() => {})
      .finally(() => setIsLoaded(true));
  }, []);

  const updateLocal = useCallback((key: SettingKey, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  }, []);

  const hasChanges = SETTING_KEYS.some((k) => settings[k] !== savedSettings[k]);

  const save = useCallback(async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const promises = SETTING_KEYS.map((key) =>
        fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value: settings[key] }),
        })
      );
      await Promise.all(promises);
      setSavedSettings({ ...settings });
      setSaveSuccess(true);
      logAction("설정 저장", "settings");
    } catch {
      // save failed
    } finally {
      setIsSaving(false);
    }
  }, [settings]);

  return { settings, updateLocal, save, isLoaded, isSaving, hasChanges, saveSuccess };
}
