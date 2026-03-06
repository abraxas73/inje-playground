"use client";

import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

export default function DooraySettings() {
  const [token, setToken, tokenLoaded] = useLocalStorage("dooray-token", "");
  const [projectId, setProjectId, projectIdLoaded] = useLocalStorage(
    "dooray-project-id",
    ""
  );

  if (!tokenLoaded || !projectIdLoaded) {
    return <div className="text-sm text-muted-foreground">로딩 중...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="dooray-token">Dooray API 토큰</Label>
        <Input
          id="dooray-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
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
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="Dooray 프로젝트 ID"
        />
        <p className="text-xs text-muted-foreground">
          Dooray 프로젝트 URL에서 확인할 수 있습니다. (예:
          https://your-org.dooray.com/project/1234567890)
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          설정한 정보는 브라우저 로컬 스토리지에만 저장되며, 서버에 전송되지
          않습니다. 사다리 게임이나 팀 나누기 페이지에서 &quot;Dooray에서
          가져오기&quot; 버튼을 통해 멤버를 불러올 수 있습니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}
