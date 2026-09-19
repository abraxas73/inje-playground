"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import type { useSettings } from "@/hooks/useSettings";
import { parseUsdKrwRate } from "@/lib/claude-cost/currency";

/** 비용 관리 화면의 원화 표시에 쓰는 환율(1달러당 원). 값은 표시 전환에만 쓰고 저장 금액(USD 센트)은 바꾸지 않는다 */
export default function ExchangeRateSettings({ settingsHook }: { settingsHook: ReturnType<typeof useSettings> }) {
  const { settings, updateLocal } = settingsHook;
  const raw = settings.usd_krw_rate;
  const rate = parseUsdKrwRate(raw);
  const invalid = raw.trim() !== "" && rate === null;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="usd-krw-rate">1 USD = ? KRW</Label>
        <div className="flex items-center gap-2">
          <Input id="usd-krw-rate" inputMode="decimal" value={raw} onChange={(e) => updateLocal("usd_krw_rate", e.target.value)} placeholder="예: 1380" className={`w-[200px] ${invalid ? "border-destructive" : ""}`} aria-invalid={invalid} />
          <span className="text-sm text-muted-foreground">원</span>
        </div>
        {invalid ? (
          <p className="text-xs text-destructive">0보다 큰 숫자를 입력하세요(천 단위 쉼표 가능).</p>
        ) : (
          <p className="text-xs text-muted-foreground">{rate ? `$7,803.38 → ₩${Math.round(7803.38 * rate).toLocaleString("ko-KR")}` : "비어 있으면 비용 관리 화면에서 원화 표시를 켜도 달러로 보입니다."}</p>
        )}
      </div>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          비용 관리(/admin/claude-cost)의 원(₩) ↔ 달러($) 표시 전환에만 쓰입니다. 인보이스 금액은 USD로 저장되고, 원화는 이 환율을 곱해 표시할 때만 계산합니다. 카드 청구 원화 금액(은행 환율)과는 다를 수 있습니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}
