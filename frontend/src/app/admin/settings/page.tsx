"use client";

import DooraySettings from "@/components/settings/DooraySettings";
import KakaoSettings from "@/components/settings/KakaoSettings";
import { useSettings } from "@/hooks/useSettings";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link2, MapPin, MessageSquare, Loader2, Save, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminSettingsPage() {
  const settingsHook = useSettings();
  const { save, isLoaded, isSaving, hasChanges, saveSuccess } = settingsHook;

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        설정을 불러오는 중...
      </div>
    );
  }

  return (
    <>
      <Card className="animate-fade-up">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Dooray 연동</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <DooraySettings settingsHook={settingsHook} />
        </CardContent>
      </Card>

      <Card className="animate-fade-up delay-100 mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Kakao 로컬 API</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <KakaoSettings settingsHook={settingsHook} />
        </CardContent>
      </Card>

      <Card className="animate-fade-up delay-200 mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Dooray 메신저</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dooray-messenger-url">메신저 채널 URL</Label>
              <Input
                id="dooray-messenger-url"
                value={settingsHook.settings.dooray_messenger_url}
                onChange={(e) => settingsHook.updateLocal("dooray_messenger_url", e.target.value)}
                placeholder="https://nhnent.dooray.com/services/..."
              />
              <p className="text-xs text-muted-foreground">
                점심 결정 시 열리는 Dooray 메신저 채널 URL
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dooray-hook-url">Incoming Hook URL</Label>
              <Input
                id="dooray-hook-url"
                value={settingsHook.settings.dooray_hook_url}
                onChange={(e) => settingsHook.updateLocal("dooray_hook_url", e.target.value)}
                placeholder="https://hook.dooray.com/services/..."
              />
              <p className="text-xs text-muted-foreground">
                메신저 채널의 Incoming Hook URL (자동 메시지 발송용)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 mt-6 animate-fade-up delay-300">
        <Button onClick={save} disabled={isSaving || !hasChanges}>
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              저장 중...
            </>
          ) : saveSuccess ? (
            <>
              <Check className="h-4 w-4 mr-2" />
              저장 완료
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              저장
            </>
          )}
        </Button>
        {hasChanges && (
          <span className="text-xs text-muted-foreground">변경사항이 있습니다</span>
        )}
      </div>
    </>
  );
}
