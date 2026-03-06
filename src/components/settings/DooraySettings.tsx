"use client";

import { useSettings } from "@/hooks/useSettings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Info, Loader2, Cloud, Save, Check } from "lucide-react";

export default function DooraySettings() {
  const { settings, updateLocal, save, isLoaded, isSaving, hasChanges, saveSuccess } = useSettings();

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        설정을 불러오는 중...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <Cloud className="h-3 w-3" />
          Supabase DB
        </Badge>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dooray-token">Dooray API 토큰</Label>
        <Input
          id="dooray-token"
          type="password"
          value={settings.dooray_token}
          onChange={(e) => updateLocal("dooray_token", e.target.value)}
          placeholder="dooray-api 토큰을 입력하세요"
        />
        <p className="text-xs text-muted-foreground">
          Dooray 개인 설정 &gt; API &gt; 개인 인증 토큰에서 발급할 수 있습니다.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dooray-project-id">프로젝트 ID</Label>
        <Input
          id="dooray-project-id"
          value={settings.dooray_project_id}
          onChange={(e) => updateLocal("dooray_project_id", e.target.value)}
          placeholder="Dooray 프로젝트 ID"
        />
        <p className="text-xs text-muted-foreground">
          Dooray 프로젝트 URL에서 확인할 수 있습니다. (예:
          https://your-org.dooray.com/project/1234567890)
        </p>
      </div>

      <div className="flex items-center gap-3">
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

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          설정 정보는 Supabase DB에 저장되어 모든 기기에서 공유됩니다.
          사다리 게임이나 팀 구성 페이지에서 &quot;Dooray에서
          가져오기&quot; 버튼을 통해 멤버를 불러올 수 있습니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}
