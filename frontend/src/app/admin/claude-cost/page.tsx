"use client";

import { useCallback, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Receipt } from "lucide-react";
import CostOverviewTab from "@/components/admin/claude-cost/CostOverviewTab";
import InvoiceImportTab from "@/components/admin/claude-cost/InvoiceImportTab";
import ApiCostTab from "@/components/admin/claude-cost/ApiCostTab";
import { CurrencyProvider, CurrencyToggle } from "@/components/admin/claude-cost/currency-context";
import type { ClaudeOrg } from "@/types/claude-usage";

export default function ClaudeCostPage() {
  const [meta, setMeta] = useState<{ apiCostAvailable: boolean; orgs: ClaudeOrg[] }>({ apiCostAvailable: false, orgs: [] });
  const onMeta = useCallback((m: { apiCostAvailable: boolean; orgs: ClaudeOrg[] }) => setMeta(m), []);
  return (
    <CurrencyProvider>
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Receipt className="h-5 w-5" />비용 관리</h1>
          <p className="text-sm text-muted-foreground">월별 실제 청구 금액(Anthropic 인보이스)과 사용량(Claude Code OTel · 채팅 CSV)을 나란히 봅니다. 결제 메일의 Stripe 인보이스 링크를 붙여 넣으면 PDF를 받아 자동으로 읽습니다.</p>
        </div>
        <CurrencyToggle />
      </div>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">월별 개요</TabsTrigger>
          <TabsTrigger value="invoices">인보이스 등록</TabsTrigger>
          {meta.apiCostAvailable && <TabsTrigger value="api">API 비용</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview"><CostOverviewTab onMeta={onMeta} /></TabsContent>
        <TabsContent value="invoices"><InvoiceImportTab orgs={meta.orgs} /></TabsContent>
        {meta.apiCostAvailable && <TabsContent value="api"><ApiCostTab /></TabsContent>}
      </Tabs>
    </div>
    </CurrencyProvider>
  );
}
