"use client";

import { useState, useEffect, useCallback } from "react";
import { logAction } from "@/lib/action-log";

interface Settings {
  dooray_token: string;
  dooray_project_id: string;
  kakao_rest_api_key: string;
  dooray_messenger_url: string;
  dooray_hook_url: string;
}

const DEFAULT_SETTINGS: Settings = {
  dooray_token: "",
  dooray_project_id: "",
  kakao_rest_api_key: "",
  dooray_messenger_url: "",
  dooray_hook_url: "",
};

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
        const loaded = {
          dooray_token: data.dooray_token || "",
          dooray_project_id: data.dooray_project_id || "",
          kakao_rest_api_key: data.kakao_rest_api_key || "",
          dooray_messenger_url: data.dooray_messenger_url || "",
          dooray_hook_url: data.dooray_hook_url || "",
        };
        setSettings(loaded);
        setSavedSettings(loaded);
      })
      .catch(() => {})
      .finally(() => setIsLoaded(true));
  }, []);

  const updateLocal = useCallback((key: keyof Settings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  }, []);

  const hasChanges =
    settings.dooray_token !== savedSettings.dooray_token ||
    settings.dooray_project_id !== savedSettings.dooray_project_id ||
    settings.kakao_rest_api_key !== savedSettings.kakao_rest_api_key ||
    settings.dooray_messenger_url !== savedSettings.dooray_messenger_url ||
    settings.dooray_hook_url !== savedSettings.dooray_hook_url;

  const save = useCallback(async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const promises = Object.entries(settings).map(([key, value]) =>
        fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
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
