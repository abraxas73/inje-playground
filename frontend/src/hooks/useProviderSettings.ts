"use client";

import { useEffect, useState } from "react";
import { parseProvider, parseMemberSourceProvider, type Provider, type MemberSourceProvider } from "@/lib/providers";

export interface ProviderSettings {
  notify: Provider;
  memberSource: MemberSourceProvider;
  dm: Provider;
}

const DEFAULTS: ProviderSettings = { notify: "dooray", memberSource: "dooray", dm: "dooray" };

/** 관리자 전역 provider 선택(3축)을 읽는다. 실패/미설정은 dooray. */
export function useProviderSettings() {
  const [providers, setProviders] = useState<ProviderSettings>(DEFAULTS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: Record<string, string>) => {
        if (cancelled) return;
        setProviders({
          notify: parseProvider(data.notify_provider),
          memberSource: parseMemberSourceProvider(data.member_source_provider),
          dm: parseProvider(data.dm_provider),
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...providers, isLoaded };
}
