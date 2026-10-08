"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, ArrowUp, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { manualSections, searchManual } from "@/lib/manual/sections";

export default function ManualPage() {
  const [query, setQuery] = useState("");
  const sections = searchManual(query);
  const categories = [...new Set(sections.map((s) => s.category))];
  return (
    <div id="manual-top" className="mx-auto max-w-4xl py-8 md:py-12">
      <header className="mb-8 space-y-3">
        <p className="text-sm font-medium text-primary">웹 · 모바일 · 데스크톱 사용 가이드</p>
        <h1 className="text-3xl font-bold tracking-tight">이노그리드 사용자 매뉴얼</h1>
        <p className="text-muted-foreground">처음 연결하는 방법부터 팀 활동, AI 도구, 앱 이노봇까지 필요한 작업을 찾아보세요.</p>
        <p className="text-xs text-muted-foreground">2026년 10월 8일 기준 · 메뉴와 기능은 계정 권한 및 운영 설정에 따라 달라집니다.</p>
        <Button asChild variant="outline"><Link href="/apps">앱 설치·다운로드 <ArrowRight className="h-4 w-4" /></Link></Button>
      </header>
      <div className="mb-8 rounded-xl border bg-card p-5">
        <label htmlFor="manual-search" className="mb-2 block text-sm font-semibold">사용법 검색</label>
        <div className="relative">
          <Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input id="manual-search" type="search" className="pl-9" placeholder="예: 내 팀, SharePoint, 출근, 이노봇" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <p role="status" className="mt-2 text-xs text-muted-foreground">전체 {manualSections.length}개 중 {sections.length}개 안내</p>
        <nav aria-label="매뉴얼 목차" className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => <div key={category}>
            <h2 className="mb-2 text-sm font-semibold">{category}</h2>
            <ul className="space-y-2">
              {sections.filter((s) => s.category === category).map((s) => <li key={s.id}>
                <a href={`#${s.id}`} className="text-sm text-primary hover:underline">{s.title}</a>
              </li>)}
            </ul>
          </div>)}
        </nav>
        {!sections.length && <div className="mt-4 space-y-2"><p className="text-sm">검색 결과가 없습니다. 서비스 이름이나 짧은 단어로 다시 찾아보세요.</p><Button variant="outline" onClick={() => setQuery("")}>검색 초기화</Button></div>}
      </div>
      <div className="space-y-10">
        {sections.map((section) => <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24 rounded-xl border bg-card p-5 md:p-7">
          <p className="mb-2 text-xs font-medium text-muted-foreground">{section.category}</p>
          <h2 id={`${section.id}-heading`} className="mb-3 text-xl font-bold">{section.title}</h2>
          <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{section.description}</p>
          <ol className="ml-5 list-decimal space-y-3 marker:font-semibold marker:text-primary">
            {section.steps.map((step) => <li key={step} className="pl-1 text-sm leading-7">{step}</li>)}
          </ol>
          {section.note && <p className="mt-5 rounded-lg bg-muted p-4 text-sm leading-relaxed"><strong>알아두세요. </strong>{section.note}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-4">
            {section.links?.map((link) => <Link key={link.href} href={link.href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{link.label}<ArrowRight aria-hidden="true" className="h-3 w-3" /></Link>)}
            <a href="#manual-top" className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"><ArrowUp aria-hidden="true" className="h-3 w-3" />목차로</a>
          </div>
        </section>)}
      </div>
    </div>
  );
}
