"use client";

import { useState, useEffect, useCallback } from "react";

interface Settings {
  dooray_token: string;
  dooray_project_id: string;
}

const DEFAULT_SETTINGS: Settings = {
  dooray_token: "",
  dooray_project_id: "",
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setSettings({
          dooray_token: data.dooray_token || "",
          dooray_project_id: data.dooray_project_id || "",
        });
      })
      .catch(() => {})
      .finally(() => setIsLoaded(true));
  }, []);

  const updateSetting = useCallback(async (key: keyof Settings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setIsSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
    } catch {
      // silently fail
    } finally {
      setIsSaving(false);
    }
  }, []);

  return { settings, updateSetting, isLoaded, isSaving };
}
