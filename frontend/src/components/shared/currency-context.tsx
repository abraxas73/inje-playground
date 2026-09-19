"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { CURRENCY_STORAGE_KEY, USD_KRW_RATE_KEY, formatMoney, formatUsdAmount, moneyCsv, csvSuffix, parseUsdKrwRate, type DisplayCurrency } from "@/lib/claude-cost/currency";

interface CurrencyValue {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
  /** 1달러당 원. 관리자 설정 usd_krw_rate. 없으면 null → 원화를 골라도 달러로 표시 */
  rate: number | null;
  rateLoaded: boolean;
  /** 센트 → 표시 통화 문자열 */
  fmt: (cents: number) => string;
  /** 달러 실수(OTel 추정 비용) → 표시 통화 문자열 */
  fmtUsd: (usd: number) => string;
  /** CSV 셀 값·헤더 접미 */
  csv: (cents: number) => string;
  suffix: "usd" | "krw";
  /** 실제로 원화로 보이는가(KRW 선택 + 환율 있음) */
  showingKrw: boolean;
}

const Ctx = createContext<CurrencyValue | null>(null);

/**
 * 표시 통화(비용 관리·Claude 사용량 화면 공용). 금액은 USD(센트 또는 달러 실수)로 저장·집계하고 원화는 표시할 때만 환율을 곱한다.
 * 선택은 브라우저에 기억하고(claude-cost-currency), 환율은 전역 설정 usd_krw_rate에서 한 번 읽는다(비밀 아님 — 일반 사용자도 /api/settings로 읽는다).
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useLocalStorage<DisplayCurrency>(CURRENCY_STORAGE_KEY, "USD");
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoaded, setRateLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: Record<string, string>) => { if (alive) setRate(parseUsdKrwRate(j?.[USD_KRW_RATE_KEY])); })
      .catch(() => { if (alive) setRate(null); })
      .finally(() => { if (alive) setRateLoaded(true); });
    return () => { alive = false; };
  }, []);
  const value = useMemo<CurrencyValue>(() => ({
    currency,
    setCurrency,
    rate,
    rateLoaded,
    fmt: (cents) => formatMoney(cents, currency, rate),
    fmtUsd: (usd) => formatUsdAmount(usd, currency, rate),
    csv: (cents) => moneyCsv(cents, currency, rate),
    suffix: csvSuffix(currency, rate),
    showingKrw: currency === "KRW" && !!rate,
  }), [currency, setCurrency, rate, rateLoaded]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrency(): CurrencyValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCurrency는 CurrencyProvider 안에서만 쓸 수 있다");
  return v;
}

/** 프로바이더 밖(토글이 없는 화면, 예: 성과)에서는 달러 고정 */
const USD_ONLY: CurrencyValue = {
  currency: "USD",
  setCurrency: () => undefined,
  rate: null,
  rateLoaded: true,
  fmt: (cents) => formatMoney(cents, "USD", null),
  fmtUsd: (usd) => formatUsdAmount(usd, "USD", null),
  csv: (cents) => moneyCsv(cents, "USD", null),
  suffix: "usd",
  showingKrw: false,
};

/**
 * 사용량 화면용 달러 포맷터. `format.ts`의 `usd`와 같은 시그니처(달러 실수 → 문자열)라 컴포넌트 안에서
 * `const { usd } = useMoney();`로 바꿔 끼우면 표시 통화를 따른다. 프로바이더가 없으면 달러 그대로.
 */
export function useMoney(): CurrencyValue & { usd: (v: number) => string } {
  const v = useContext(Ctx) ?? USD_ONLY;
  return { ...v, usd: v.fmtUsd };
}

/** 헤더의 $ ↔ ₩ 전환 버튼. 환율이 없으면 ₩를 눌러도 달러로 보이고 그 이유를 옆에 적는다 */
export function CurrencyToggle() {
  const { currency, setCurrency, rate, rateLoaded } = useCurrency();
  const noRate = rateLoaded && rate === null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">표시</span>
      <div className="inline-flex rounded-md border overflow-hidden">
        {(["USD", "KRW"] as DisplayCurrency[]).map((c) => (
          <Button key={c} type="button" size="sm" variant={currency === c ? "default" : "ghost"} className="h-7 rounded-none px-3 text-xs" onClick={() => setCurrency(c)} aria-pressed={currency === c}>
            {c === "USD" ? "$ 달러" : "₩ 원"}
          </Button>
        ))}
      </div>
      {currency === "KRW" && rate && <span className="text-muted-foreground">₩{rate.toLocaleString("ko-KR")}/$ · 시스템 설정의 환율</span>}
      {currency === "KRW" && noRate && <span className="text-destructive">환율이 없어 달러로 표시 — 어드민 &gt; 시스템 설정 &gt; 환율에 입력하세요</span>}
    </div>
  );
}
