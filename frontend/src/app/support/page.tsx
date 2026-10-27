import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "고객 지원 | 이노그리드 (INNOGRID)",
  description: "이노그리드 앱·이노크루 웹 서비스 이용 문의와 지원 안내",
};

const SUPPORT_EMAIL = "seunguk.kang@innogrid.com";

// App Store 지원 URL — 로그인 없이 열려야 한다(supabase-middleware PUBLIC_PREFIXES, 심사 지침 1.5).
export default function SupportPage() {
  return (
    <div className="min-h-screen dot-grid">
      <main className="max-w-3xl mx-auto px-4 md:px-8 py-10 md:py-14 space-y-8 text-sm leading-relaxed text-foreground/85">
        <header className="text-center">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">고객 지원</h1>
          <p className="mt-3 text-muted-foreground">이노그리드 앱(INNOGRID)과 이노크루 웹 서비스 · 운영 주식회사 이노그리드</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">문의하기</h2>
          <p>
            사용 방법, 로그인 문제, 오류 신고, 기능 제안은 이메일로 보내 주세요:{" "}
            <a className="font-semibold text-primary underline" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("이노그리드 앱 문의")}`}>{SUPPORT_EMAIL}</a>
          </p>
          <p>평일 09:00~18:00(한국 시간)에 확인하며, 영업일 기준 2일 이내에 회신합니다.</p>
          <p>오류를 신고할 때는 앱 버전(더보기 화면 아래), 기기·운영체제, 발생 시각과 화면을 함께 적어 주시면 빠르게 확인할 수 있습니다.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">자주 묻는 질문</h2>
          <dl className="space-y-3">
            <div>
              <dt className="font-semibold text-foreground">누가 사용할 수 있나요?</dt>
              <dd>이노그리드 구성원용 앱으로, 회사 Microsoft 계정으로 로그인합니다.</dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">로그인이 되지 않습니다.</dt>
              <dd>회사 계정의 다단계 인증을 완료했는지 확인하고, 계속 실패하면 위 이메일로 로그인 이메일과 오류 메시지를 보내 주세요.</dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">그룹웨어(아마란스) 기능이 보이지 않습니다.</dt>
              <dd>더보기 &gt; 아마란스에서 본인 그룹웨어 계정을 연결해야 일정·결재·메일 기능을 쓸 수 있습니다.</dd>
            </div>
          </dl>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">관련 안내</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><Link className="text-primary underline" href="/privacy">개인정보처리방침</Link></li>
            <li><Link className="text-primary underline" href="/account-deletion">계정 삭제 요청</Link></li>
            <li><Link className="text-primary underline" href="/manual">사용자 매뉴얼</Link>(로그인 필요)</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
