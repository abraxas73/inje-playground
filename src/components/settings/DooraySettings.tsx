"use client";

import { useLocalStorage } from "@/hooks/useLocalStorage";

export default function DooraySettings() {
  const [token, setToken, tokenLoaded] = useLocalStorage("dooray-token", "");
  const [projectId, setProjectId, projectIdLoaded] = useLocalStorage(
    "dooray-project-id",
    ""
  );

  if (!tokenLoaded || !projectIdLoaded) {
    return <div className="text-sm text-slate-400">로딩 중...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Dooray API 토큰
        </label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="dooray-api 토큰을 입력하세요"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-slate-500 mt-1">
          Dooray 개인 설정 &gt; API &gt; 개인 인증 토큰에서 발급할 수 있습니다.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          프로젝트 ID
        </label>
        <input
          type="text"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="Dooray 프로젝트 ID"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-slate-500 mt-1">
          Dooray 프로젝트 URL에서 확인할 수 있습니다. (예:
          https://your-org.dooray.com/project/1234567890)
        </p>
      </div>

      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-700">
          설정한 정보는 브라우저 로컬 스토리지에만 저장되며, 서버에 전송되지
          않습니다. 사다리 게임이나 팀 나누기 페이지에서 &quot;Dooray에서
          가져오기&quot; 버튼을 통해 멤버를 불러올 수 있습니다.
        </p>
      </div>
    </div>
  );
}
