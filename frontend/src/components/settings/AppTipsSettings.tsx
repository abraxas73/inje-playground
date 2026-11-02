"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import type { useSettings } from "@/hooks/useSettings";
import { DEFAULT_APP_TIPS, TIP_MAX, TIP_TEXT_MAX, TIP_WEIGHT_MAX, parseAppTips, type AppTip } from "@/lib/app-tips";

/** 데스크톱 앱 홈 상단 "Tip!" 목록 — 글·가중치(0~10, 0은 숨김). 가중치가 클수록 자주 나온다. 저장은 페이지 하단 [저장]. */
export default function AppTipsSettings({ settingsHook }: { settingsHook: ReturnType<typeof useSettings> }) {
  const { settings, updateLocal } = settingsHook;
  const tips = parseAppTips(settings.app_tips, true);
  const total = tips.reduce((s, t) => s + t.weight, 0);
  const set = (next: AppTip[]) => updateLocal("app_tips", JSON.stringify(next));
  const edit = (i: number, patch: Partial<AppTip>) => set(tips.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        데스크톱 앱 홈 맨 위에 한 줄씩 나오는 팁입니다. 가중치가 클수록 자주 나오고(2면 1의 두 배), 0이면 나오지 않습니다. 빈 글은 앱에 나오지 않습니다.
      </p>
      <div className="space-y-2">
        {tips.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 text-right text-xs text-muted-foreground">{i + 1}</span>
            <Input value={t.text} maxLength={TIP_TEXT_MAX} onChange={(e) => edit(i, { text: e.target.value })} aria-label={`팁 ${i + 1}`} />
            <Input
              type="number" min={0} max={TIP_WEIGHT_MAX} step={1} className="w-20"
              value={t.weight}
              onChange={(e) => edit(i, { weight: Math.min(TIP_WEIGHT_MAX, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
              aria-label={`팁 ${i + 1} 가중치`}
            />
            <span className="w-12 text-right text-xs text-muted-foreground">{total && t.weight ? `${Math.round((t.weight / total) * 100)}%` : "숨김"}</span>
            <Button variant="ghost" size="icon" onClick={() => set(tips.filter((_, j) => j !== i))} aria-label={`팁 ${i + 1} 삭제`}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={tips.length >= TIP_MAX} onClick={() => set([...tips, { text: "새 팁", weight: 1 }])}>
          <Plus className="h-4 w-4 mr-1" /> 팁 추가
        </Button>
        <Button variant="ghost" size="sm" onClick={() => set(DEFAULT_APP_TIPS)}>
          <RotateCcw className="h-4 w-4 mr-1" /> 기본 목록으로
        </Button>
      </div>
    </div>
  );
}
