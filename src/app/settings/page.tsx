"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import DooraySettings from "@/components/settings/DooraySettings";
import KakaoSettings from "@/components/settings/KakaoSettings";
import { useSettings } from "@/hooks/useSettings";
import { createClient } from "@/lib/supabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, Link2, MapPin, Loader2, Save, Check, ShieldAlert } from "lucide-react";

const SUPER_USER = "abraxas73@gmail.com";

export default function SettingsPage() {
  const router = useRouter();
  const settingsHook = useSettings();
  const { save, isLoaded, isSaving, hasChanges, saveSuccess } = settingsHook;
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const isSuper = data.user?.email === SUPER_USER;
      setAuthorized(isSuper);
      if (!isSuper) {
        router.replace("/");
      }
    });
  }, [router]);

  if (authorized === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        권한 확인 중...
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p className="text-sm">접근 권한이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center">
          <Settings className="h-5 w-5 text-slate-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">설정</h1>
          <p className="text-sm text-muted-foreground">외부 서비스 연동을 설정합니다</p>
        </div>
      </div>

      {!isLoaded ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          설정을 불러오는 중...
        </div>
      ) : (
        <>
          <Card className="animate-fade-up delay-100">
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

          <Card className="animate-fade-up delay-200 mt-6">
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
      )}
    </div>
  );
}
