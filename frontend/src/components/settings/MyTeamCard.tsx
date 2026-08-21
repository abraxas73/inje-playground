"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, X, Loader2, ListChecks } from "lucide-react";
import { useUserMembers } from "@/hooks/useUserMembers";
import { useProviderSettings } from "@/hooks/useProviderSettings";
import MyTeamPicker from "@/components/shared/MyTeamPicker";

/** 개인 설정: 내 팀 구성원 보기/편집 (사다리·팀 나누기·점심의 기본 명단) */
export default function MyTeamCard() {
  const userMembers = useUserMembers();
  const { memberSource, isLoaded } = useProviderSettings();
  const [open, setOpen] = useState(false);
  const canPick = isLoaded && memberSource !== "dooray";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          내 팀 구성원
          {!userMembers.loading && (
            <span className="text-xs font-normal text-muted-foreground">({userMembers.members.length}명)</span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          사다리·팀 나누기·점심에서 기본으로 쓰는 내 팀입니다. 직접 고르거나 이름·이메일로 추가할 수 있습니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {userMembers.loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            불러오는 중...
          </div>
        ) : userMembers.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 내 팀이 없습니다. 아래 버튼으로 구성원을 골라 주세요.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {userMembers.members.map((m) => (
              <Badge key={m.id} variant="secondary" className="gap-1 text-xs font-normal" title={m.email ?? undefined}>
                {m.name}
                {m.is_card_holder && <span className="text-amber-600">(법카)</span>}
                <button
                  type="button"
                  onClick={() => userMembers.removeMember(m)}
                  className="hover:text-destructive"
                  aria-label={`${m.name} 제외`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!canPick}>
            <ListChecks className="h-4 w-4 mr-1.5" />
            구성원 선택
          </Button>
          {isLoaded && memberSource === "dooray" && (
            <span className="text-xs text-muted-foreground">
              Dooray 모드에서는 사다리/팀 페이지의 &quot;Dooray에서 가져오기&quot;로 명단을 채웁니다.
            </span>
          )}
        </div>
      </CardContent>

      <MyTeamPicker
        open={open}
        onOpenChange={setOpen}
        provider={memberSource}
        current={userMembers.members}
        onSave={(drafts) => userMembers.saveImported(drafts)}
      />
    </Card>
  );
}
