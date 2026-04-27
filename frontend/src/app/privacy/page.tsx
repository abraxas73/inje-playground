import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "개인정보처리방침 | NHN InjeInc Workshop",
  description:
    "NHN 인재아이엔씨 워크샵 서비스의 개인정보 수집 및 이용에 관한 안내",
};

const EFFECTIVE_DATE = "2026-04-27";

interface Section {
  id: string;
  title: string;
  content: React.ReactNode;
}

const sections: Section[] = [
  {
    id: "purpose",
    title: "1. 개인정보 처리 목적",
    content: (
      <>
        <p>
          NHN 인재아이엔씨 워크샵 서비스(이하 &quot;서비스&quot;)는 NHN 인재아이엔씨
          구성원의 팀 활동과 일상 업무를 돕기 위한 사내 유틸리티 도구입니다.
          수집한 개인정보는 다음의 목적을 위해서만 처리되며, 목적 외의 용도로는
          이용되지 않습니다.
        </p>
        <ul>
          <li>구성원 인증 및 로그인 상태 유지</li>
          <li>사다리 게임, 커피 타임, 가이드 Q&amp;A 등 기능 제공</li>
          <li>이용 이력 기록 및 서비스 품질 개선</li>
          <li>관리자 기능을 위한 권한 관리</li>
        </ul>
      </>
    ),
  },
  {
    id: "items",
    title: "2. 수집하는 개인정보 항목",
    content: (
      <>
        <p>서비스는 다음과 같은 정보를 수집합니다.</p>
        <h3>가. Google 계정 인증을 통해 자동 수집되는 항목</h3>
        <ul>
          <li>이메일 주소</li>
          <li>이름(표시 이름)</li>
          <li>프로필 이미지 URL</li>
          <li>Google 계정 고유 식별자(sub)</li>
        </ul>
        <h3>나. 서비스 이용 과정에서 생성·저장되는 항목</h3>
        <ul>
          <li>로그인 일시 및 로그인 이력</li>
          <li>역할 정보(guest / user / admin)</li>
          <li>사용자가 직접 등록한 표시 이름</li>
          <li>사다리 게임·커피 타임 참여자 명단 및 결과</li>
          <li>가이드 Q&amp;A 질의 내용 및 답변 이력</li>
          <li>서비스 이용 행동 로그(클릭, 페이지 이동 등 운영상 필요한 범위)</li>
        </ul>
        <h3>다. 사용자가 선택적으로 입력하는 항목</h3>
        <ul>
          <li>Dooray API 토큰 및 프로젝트 ID(브라우저 localStorage에 저장)</li>
          <li>맛집/카페 검색 키워드 및 위치 정보</li>
        </ul>
      </>
    ),
  },
  {
    id: "retention",
    title: "3. 개인정보의 보유 및 이용 기간",
    content: (
      <>
        <p>
          개인정보는 수집·이용 목적이 달성되면 지체 없이 파기합니다. 다만,
          다음의 정보는 명시된 기간 동안 보관합니다.
        </p>
        <ul>
          <li>
            <strong>계정 정보</strong>: 회원 탈퇴 또는 퇴사 시까지
          </li>
          <li>
            <strong>로그인 이력</strong>: 최근 1년 이내의 기록
          </li>
          <li>
            <strong>가이드 Q&amp;A 이력</strong>: 회원 탈퇴 또는 퇴사 시까지
            (관리자 분석 목적)
          </li>
          <li>
            <strong>서비스 이용 행동 로그</strong>: 최근 6개월 이내의 기록
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "third-party",
    title: "4. 개인정보의 제3자 제공",
    content: (
      <>
        <p>
          서비스는 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다.
          다음의 경우에 한하여 외부 서비스가 활용되며, 모두 사내 업무 처리에
          필요한 범위 내에서만 사용됩니다.
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> — 사용자 프로필, 채팅 이력, 설정 등
            데이터베이스 저장
          </li>
          <li>
            <strong>Google OAuth</strong> — 사내 구성원 인증
          </li>
          <li>
            <strong>Google NotebookLM</strong> — 가이드 Q&amp;A 응답 생성(관리자가
            업로드한 문서 기반)
          </li>
          <li>
            <strong>Dooray</strong> — 사용자가 토큰을 등록한 경우에 한해 프로젝트
            구성원 정보 조회
          </li>
          <li>
            <strong>Vercel / Fly.io</strong> — 애플리케이션 호스팅 및 배포
          </li>
          <li>
            <strong>Inje Chrome Extension</strong> — 사내 구성원 편의를 위한
            브라우저 확장 프로그램. 본 서비스의 인증 세션과 연동되어 일부 기능을
            보조하며, 수집·처리하는 정보의 범위는 본 처리방침을 따릅니다.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "rights",
    title: "5. 정보주체의 권리·의무 및 행사 방법",
    content: (
      <>
        <p>이용자는 언제든지 다음의 권리를 행사할 수 있습니다.</p>
        <ul>
          <li>개인정보 열람·정정·삭제 요청</li>
          <li>개인정보 처리 정지 요청</li>
          <li>회원 탈퇴 및 계정 삭제 요청</li>
        </ul>
        <p>
          위 권리 행사는 서비스 내 프로필 페이지에서 직접 처리하거나, 아래 문의
          창구를 통해 요청할 수 있습니다.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "6. 개인정보의 안전성 확보 조치",
    content: (
      <>
        <p>
          서비스는 개인정보 보호를 위해 다음과 같은 조치를 취하고 있습니다.
        </p>
        <ul>
          <li>HTTPS 기반의 암호화된 통신</li>
          <li>Supabase Row Level Security(RLS)를 통한 데이터 접근 제어</li>
          <li>역할 기반 접근 권한 관리(guest / user / admin)</li>
          <li>
            Dooray API 토큰 등 민감 정보는 브라우저 localStorage에만 저장되며,
            서버에 전송되지 않음
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "cookies",
    title: "7. 쿠키 및 로컬 저장소 사용",
    content: (
      <>
        <p>
          서비스는 사용자 경험 향상을 위해 쿠키와 브라우저 로컬 저장소를
          사용합니다.
        </p>
        <ul>
          <li>
            <strong>인증 쿠키</strong> — Supabase 세션 유지를 위해 사용
          </li>
          <li>
            <strong>localStorage</strong> — 사다리/팀 게임 참여자, Dooray 설정,
            UI 상태 등 사용자 편의를 위한 데이터 저장
          </li>
        </ul>
        <p>
          브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 일부 기능 이용에
          제한이 있을 수 있습니다.
        </p>
      </>
    ),
  },
  {
    id: "officer",
    title: "8. 개인정보 보호책임자 및 문의",
    content: (
      <>
        <p>
          개인정보 처리에 관한 문의·민원은 아래 창구로 연락해 주시기 바랍니다.
        </p>
        <ul>
          <li>
            <strong>운영 주체</strong>: NHN 인재아이엔씨
          </li>
          <li>
            <strong>문의</strong>: 사내 가이드 채널 또는 워크샵 운영 담당자
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "changes",
    title: "9. 처리방침의 변경",
    content: (
      <>
        <p>
          본 개인정보처리방침은 법령·정책의 변경 또는 서비스 개선에 따라 사전
          공지 후 변경될 수 있습니다. 변경 시에는 본 페이지를 통해 시행 일자와
          함께 안내합니다.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen dot-grid">
      <main className="max-w-3xl mx-auto px-4 md:px-8 py-10 md:py-14">
        <header className="mb-10 text-center">
          <Link href="/" className="inline-flex items-center justify-center mb-6">
            <Image src="/logo.svg" alt="NHN InjeInc" width={140} height={16} priority />
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            개인정보처리방침
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            시행일자: {EFFECTIVE_DATE}
          </p>
        </header>

        <nav className="mb-10 rounded-xl border bg-card p-4 md:p-5">
          <p className="text-xs font-semibold text-muted-foreground mb-3">목차</p>
          <ol className="grid gap-1.5 text-sm md:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="text-foreground/80 hover:text-foreground hover:underline"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="space-y-10">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-8">
              <h2 className="text-lg md:text-xl font-semibold mb-4 pb-2 border-b">
                {s.title}
              </h2>
              <div className="prose-privacy text-sm leading-relaxed text-foreground/85 space-y-3">
                {s.content}
              </div>
            </section>
          ))}
        </article>

        <footer className="mt-16 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>NHN InjeInc Workshop &copy; 2026</p>
          <Link href="/login" className="hover:text-foreground hover:underline">
            로그인 페이지로 돌아가기
          </Link>
        </footer>
      </main>

      <style>{`
        .prose-privacy h3 {
          font-size: 0.95rem;
          font-weight: 600;
          margin-top: 0.75rem;
          margin-bottom: 0.5rem;
        }
        .prose-privacy ul {
          list-style: disc;
          padding-left: 1.25rem;
          margin: 0.25rem 0;
        }
        .prose-privacy li {
          margin: 0.2rem 0;
        }
        .prose-privacy strong {
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
