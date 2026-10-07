import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "계정 삭제 요청 | 이노크루 (InnoCrew)",
  description: "이노크루(InnoCrew) 앱·이노그리드 워크샵 서비스 계정 및 데이터 삭제 요청 방법",
};

// Google Play 데이터 보안 '계정 삭제 URL' — 로그인 없이 열려야 한다(supabase-middleware PUBLIC_PREFIXES).
export default function AccountDeletionPage() {
  return (
    <div className="min-h-screen dot-grid">
      <main className="max-w-3xl mx-auto px-4 md:px-8 py-10 md:py-14 space-y-8 text-sm leading-relaxed text-foreground/85">
        <header className="text-center">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">계정 삭제 요청</h1>
          <p className="mt-3 text-muted-foreground">Google Play 앱 &quot;이노크루&quot;(InnoCrew, 앱 내 표시 이름: 이노그리드, Android·iOS)와 이노그리드 워크샵 웹 서비스 · 운영 이노그리드</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">요청 방법</h2>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              회사 이메일로 <strong>seunguk.kang@innogrid.com</strong>에 제목 &quot;이노크루 앱 계정 삭제 요청&quot;으로
              메일을 보냅니다(로그인에 쓰는 이메일 주소를 적어 주세요).
            </li>
            <li>운영 담당자가 본인 여부를 확인한 뒤 <strong>7일 이내</strong>에 삭제하고 결과를 회신합니다.</li>
            <li>
              휴대폰에 저장된 정보(그룹웨어 로그인 정보, 앱 설정, 비서 실행 기록)는 앱을 삭제하면 함께 지워집니다.
              앱 안 더보기 &gt; 로그아웃·아마란스 연결 해제로도 지울 수 있습니다.
            </li>
          </ol>
          <p>계정은 유지하고 일부 데이터만 지우고 싶으면 같은 메일로 지울 항목을 적어 요청하세요.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">삭제되는 데이터</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>계정 프로필(이름·이메일·역할·표시 이름)과 개인 설정</li>
            <li>내 팀 구성, 연결한 Microsoft 계정 정보(암호화된 토큰)</li>
            <li>가이드 Q&amp;A 질의·답변 이력, PPT 만들기 원고·결과물 등 본인이 만든 데이터</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">보관되는 데이터와 기간</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>로그인 이력·보안 감사 기록: 보안 및 부정 사용 방지를 위해 최대 1년 보관 후 삭제</li>
            <li>다른 구성원과 함께 쓴 기록(예: 사다리 게임 결과의 참여자 이름)은 그 기록의 일부로 남을 수 있습니다</li>
          </ul>
          <p>비서 대화 내용은 처음부터 서버에 저장하지 않으므로 삭제할 대상이 없습니다.</p>
        </section>

        <footer className="pt-6 border-t text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground hover:underline">개인정보처리방침</Link>
        </footer>
      </main>
    </div>
  );
}
