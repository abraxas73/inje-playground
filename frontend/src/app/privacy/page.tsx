import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "개인정보처리방침 | Innogrid Workshop",
  description:
    "이노그리드 워크샵 서비스의 개인정보 수집 및 이용에 관한 안내",
};

const EFFECTIVE_DATE = "2026-10-07";

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
          이노그리드 워크샵 서비스와 모바일 앱 &quot;이노그리드&quot;(Android·iOS, 이하
          함께 &quot;서비스&quot;)는 이노그리드 구성원의 팀 활동과 일상 업무를 돕기
          위한 사내 유틸리티 도구입니다.
          수집한 개인정보는 다음의 목적을 위해서만 처리되며, 목적 외의 용도로는
          이용되지 않습니다.
        </p>
        <ul>
          <li>구성원 인증 및 로그인 상태 유지</li>
          <li>사다리 게임, 커피 타임, 가이드 Q&amp;A 등 기능 제공</li>
          <li>이용 이력 기록 및 서비스 품질 개선</li>
          <li>관리자 기능을 위한 권한 관리</li>
          <li>
            모바일 앱: 그룹웨어(아마란스) 일정·메일·결재·게시판·출퇴근 조회와
            기록, 홈 브리핑, AI 비서 &quot;이노봇&quot;(회의실 예약·일정 등록 등 사용자가
            요청하고 확인한 작업 수행)
          </li>
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
        <h3>가. Microsoft(사내 조직 계정) 또는 Google 계정 인증을 통해 자동 수집되는 항목</h3>
        <ul>
          <li>이메일 주소</li>
          <li>이름(표시 이름)</li>
          <li>프로필 이미지 URL</li>
          <li>계정 고유 식별자</li>
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
        <h3>라. Jira 연결 시 처리되는 항목</h3>
        <ul>
          <li>Atlassian 계정 식별자, 이름, 회사 이메일, 연결 일시와 암호화된 OAuth 인증 정보</li>
          <li>본인 담당 이슈의 제목·상태·마감일·설명·댓글을 조회하고 사용자가 확인한 상태 변경·댓글 작성을 Jira에 전송합니다.</li>
          <li>브리핑 생성 시 진행 중 이슈의 키·제목·상태·마감일을 AI 모델에 전달하며 설명·댓글·인증 정보는 포함하지 않습니다.</li>
        </ul>
        <h3>마. 모바일 앱에서 처리되는 항목</h3>
        <ul>
          <li>
            <strong>위치</strong>: &quot;뭐 먹지&quot;에서 주변 식당·카페를 찾을 때만, 앱을
            사용하는 동안 사용합니다. 검색에만 쓰고 서버에 저장하지 않습니다.
          </li>
          <li>
            <strong>마이크·음성</strong>: 이노봇에게 말로 요청할 때(🎤를 누른 동안)만
            사용합니다. 음성은 휴대폰 운영체제의 음성 인식 기능이 글자로 바꾸며,
            운영체제 제공자(Apple·Google)의 서버에서 처리될 수 있습니다. 앱은 녹음을
            저장하거나 우리 서버로 보내지 않습니다. 답변 읽어 주기(🔊)는 기기 안에서
            처리됩니다.
          </li>
          <li>
            <strong>그룹웨어(아마란스) 연결 정보</strong>: 사용자가 연결한 경우 로그인
            정보는 기기의 보안 저장소(Keychain·Keystore)에만 저장되며 서버로 보내지
            않습니다. 일정·메일·결재·게시판 등은 기기에서 그룹웨어로 직접 조회합니다.
          </li>
          <li>
            <strong>비서·브리핑 처리 내용</strong>: 이노봇에게 한 요청과 그 처리에 필요한
            조회 결과(예: 빈 회의실, 사용자가 읽어 달라고 한 메일), 홈 브리핑용 제목 수준
            요약은 응답 생성을 위해 서버를 거쳐 AI 모델(Anthropic Claude)로 일시 전송되며,
            서버는 대화 내용을 저장하지 않습니다(감사 기록에는 사용한 기능 이름·건수만
            남습니다). 되돌리기용 최근 실행 기록(최대 20건)은 기기에만 저장됩니다.
          </li>
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
            <strong>Jira 연결 정보</strong>: 설정에서 연결 해제하거나 서비스 계정을 삭제하면 삭제됩니다. Atlassian 계정의 연결된 앱에서도 권한을 철회할 수 있습니다.
          </li>
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
            <strong>Microsoft(Azure AD·Microsoft Graph) / Google OAuth</strong> — 사내
            구성원 인증, 사용자가 연결한 경우 Teams 메시지·SharePoint 파일 처리
          </li>
          <li>
            <strong>Anthropic(Claude)</strong> — 모바일 앱 비서·홈 브리핑, PPT 만들기 등
            AI 응답 생성(요청 처리에 필요한 범위, 서비스가 대화 내용을 저장하지 않음)
          </li>
          <li>
            <strong>Atlassian Jira</strong> — 사용자가 연결한 회사 Jira 계정의 담당 업무 조회 및 요청한 상태 변경·댓글 처리
          </li>
          <li>
            <strong>더존 아마란스(그룹웨어)</strong> — 모바일 앱에서 사용자가 연결한
            경우, 기기에서 직접 조회·기록
          </li>
          <li>
            <strong>Apple·Google</strong> — 모바일 앱 배포(TestFlight·Google Play),
            기기 음성 인식
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
            <strong>Innogrid Chrome Extension</strong> — 사내 구성원 편의를 위한
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
          창구를 통해 요청할 수 있습니다. 계정 및 데이터 삭제 절차와 삭제·보관되는
          항목은{" "}
          <Link href="/account-deletion" className="underline">
            계정 삭제 요청 안내
          </Link>
          에 있습니다.
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
            <strong>운영 주체</strong>: 이노그리드
          </li>
          <li>
            <strong>문의</strong>: 서비스 운영 담당자(seunguk.kang@innogrid.com) 또는 사내
            가이드 채널
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
            <Image src="/logo.svg" alt="이노그리드" width={115} height={16} priority />
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
          <p>Innogrid Workshop &copy; 2026</p>
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
