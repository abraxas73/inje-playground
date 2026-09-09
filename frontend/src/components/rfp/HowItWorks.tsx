"use client";

import { ArrowRight, BookOpen, FileSearch, ListChecks, Sparkles, Table2 } from "lucide-react";

/**
 * /rfp 아래쪽 안내 — 이 기능이 어떻게 동작하는지와 매핑 판정이 어디서 나오는지(카탈로그) 설명.
 * 카탈로그 규모·후보 상한은 실제 설정값을 받아 표시한다(설명이 화면 상태와 어긋나지 않게).
 */
export default function HowItWorks({ solutions, features, maxCandidates, llmAvailable }: {
  solutions: number;
  features: number;
  maxCandidates: number;
  llmAvailable: boolean;
}) {
  const steps = [
    { icon: FileSearch, title: "1. 업로드·등록", body: "hwp·hwpx·docx는 표준 요구사항 표(7행)를, xlsx는 요건표 시트(한 행 = 한 요구사항)를 규칙으로 읽습니다. PDF는 표 구조가 없어 글자 좌표로 표를 복원해 같은 규칙을 적용합니다(스캔한 이미지 PDF는 읽지 못합니다). 비표준 문서만 Claude가 추출합니다. 사업명·발주기관·기간·금액은 문서에서 찾아 채우고, 같은 파일·같은 사업명은 중복으로 알려 줍니다." },
    { icon: Table2, title: "2. 요구사항 표", body: "구분 탭으로 나눠 보고 셀을 눌러 바로 고칩니다. 총괄표가 있으면 구분마다 분류명이 붙고 건수를 대조해 경고를 남깁니다. 행 추가·삭제도 됩니다." },
    { icon: Sparkles, title: "3. 솔루션 매핑", body: `요구사항의 세부 내용이 목록이면 1단 항목마다(2depth는 1단으로 묶어) 후보를 냅니다. 대상 솔루션을 골라 실행하고, 세부 항목당 최대 ${maxCandidates}개·솔루션당 2개까지 제시합니다. 규칙 엔진은 "후보"만 내며 충족·부분충족 확정은 사람이 합니다.` },
    { icon: ListChecks, title: "4. 산출", body: "판정·근거를 담은 xlsx를 내려받거나 SharePoint 폴더에 올립니다(같은 날 다시 올리면 덮어쓰고 Teams로 알립니다)." },
  ];
  return (
    <section className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">동작 방식과 매핑 정보 소스</h2>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s) => (
          <div key={s.title} className="rounded-md border bg-background p-3">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <s.icon className="h-4 w-4 text-violet-600" />
              {s.title}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border bg-background p-3">
          <div className="mb-1 text-sm font-medium">매핑 정보 소스 — 솔루션 기능 카탈로그</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            판정은 관리자가 관리하는 <span className="font-medium text-foreground">솔루션 기능 카탈로그</span>만 근거로 합니다. 현재 활성 솔루션 {solutions.toLocaleString("ko-KR")}개 · 활성 기능 {features.toLocaleString("ko-KR")}개.
            기능은 Confluence 기능 소개·기능명세서 페이지와 SharePoint xlsx 기능명세서에서 가져오고(규칙 파서{llmAvailable ? ", 필요하면 Claude로 보강" : ""}), 사람이 고친 항목은 다시 가져와도 유지됩니다.
            기능마다 키워드와 출처 문서 링크가 붙습니다. 카탈로그에 없는 기능은 절대 매핑되지 않으니, 빠진 제품 기능은 관리자에게 카탈로그 등록을 요청하세요.
          </p>
        </div>
        <div className="rounded-md border bg-background p-3">
          <div className="mb-1 text-sm font-medium">판정 근거와 한계</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            규칙 엔진은 기능 키워드 일치와 문자 유사도로 점수를 매기고(행 오른쪽 회색 글씨: 일치 키워드·유사도·점수),
            기능 설명에서 요구 문장과 가장 많이 겹치는 문장을 <span className="font-medium text-foreground">근거</span>로 함께 저장합니다. 문서 카드의 &quot;바로가기&quot;로 원문을 확인하세요.
            {llmAvailable ? " Claude 엔진을 고르면 충족·부분충족·설계·구축영역·해당없음으로 판정하고 인용 문장을 남깁니다." : " Claude 엔진은 API 키가 설정되면 선택할 수 있습니다."}
            {" "}짧은 항목은 범용어에 끌릴 수 있어 후보는 검토 대상입니다. 사람이 고친 행에는 ✎가 붙고 다시 실행해도 덮어쓰지 않습니다.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">흐름</span>
        {["문서 업로드", "요구사항 추출", "표 검토·수정", "솔루션 매핑", "후보 확정", "xlsx·SharePoint"].map((t, i, arr) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className="rounded bg-background px-1.5 py-0.5">{t}</span>
            {i < arr.length - 1 && <ArrowRight className="h-3 w-3" />}
          </span>
        ))}
      </div>
    </section>
  );
}
