"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import type { useSettings } from "@/hooks/useSettings";

interface KakaoSettingsProps {
  settingsHook: ReturnType<typeof useSettings>;
}

export default function KakaoSettings({ settingsHook }: KakaoSettingsProps) {
  const { settings, updateLocal } = settingsHook;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="kakao-api-key">Kakao REST API 키</Label>
        <Input
          id="kakao-api-key"
          type="password"
          value={settings.kakao_rest_api_key}
          onChange={(e) => updateLocal("kakao_rest_api_key", e.target.value)}
          placeholder="Kakao REST API 키를 입력하세요"
        />
        <p className="text-xs text-muted-foreground">
          Kakao Developers &gt; 내 애플리케이션 &gt; 앱 키에서 REST API 키를 확인할 수 있습니다.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          &quot;오늘 뭐 먹지&quot; 기능에서 주변 음식점을 검색할 때 사용됩니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}
