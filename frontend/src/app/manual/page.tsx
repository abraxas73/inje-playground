"use client";

import Image from "next/image";

const sections = [
  {
    id: "login",
    title: "1. 로그인",
    description:
      "Google 계정으로 로그인합니다. NHN 인재아이엔씨 구성원이라면 누구나 사용할 수 있습니다.",
    steps: [
      "앱에 접속하면 로그인 화면이 표시됩니다.",
      '"Google로 로그인" 버튼을 클릭합니다.',
      "Google 계정 선택 후 인증을 완료합니다.",
      "로그인 후 메인 화면으로 이동합니다.",
    ],
    images: [{ src: "/manual/01-login.png", alt: "로그인 화면" }],
  },
  {
    id: "home",
    title: "2. 메인 화면",
    description:
      "로그인 후 표시되는 메인 화면입니다. 각 서비스 카드를 클릭하여 해당 기능으로 이동할 수 있습니다.",
    steps: [
      "상단 네비게이션 바에서 각 메뉴로 바로 이동할 수 있습니다.",
      "우측 상단의 프로필 버튼을 클릭하면 프로필, 설정, 로그아웃 메뉴가 표시됩니다.",
      "각 서비스 카드를 클릭하면 해당 페이지로 이동합니다.",
    ],
    images: [
      { src: "/manual/02-home.png", alt: "메인 화면" },
      { src: "/manual/03-profile-menu.png", alt: "프로필 드롭다운 메뉴" },
    ],
  },
  {
    id: "profile",
    title: "3. 프로필",
    description:
      "자신의 계정 정보를 확인하고 표시 이름을 수정할 수 있습니다. 이름은 사다리 게임, 커피 타임 등에서 표시됩니다.",
    steps: [
      "우측 상단 프로필 버튼 → '프로필' 클릭",
      "이름, 이메일, 역할(관리자/사용자/게스트)을 확인할 수 있습니다.",
      "이름 옆 연필 아이콘을 클릭하면 표시 이름을 변경할 수 있습니다.",
    ],
    images: [{ src: "/manual/04-profile.png", alt: "프로필 화면" }],
    usage:
      "표시 이름은 사다리 게임, 커피 타임의 참여자 명단과 Dooray 알림 등에서 사용됩니다.",
  },
  {
    id: "settings",
    title: "4. 설정",
    description:
      "Dooray 연동을 위한 개인 설정 페이지입니다. API 토큰, 프로젝트, 본인 인증을 설정합니다.",
    steps: [
      "우측 상단 프로필 버튼 → '설정' 클릭",
      "API 토큰: Dooray > 개인 설정 > API에서 발급한 개인 인증 토큰을 입력합니다.",
      "프로젝트: '프로젝트 불러오기'를 클릭하여 소속 프로젝트를 선택하거나, 프로젝트 ID를 직접 입력합니다.",
      "본인 인증: '구성원 불러오기'를 클릭하고, 목록에서 본인을 선택합니다.",
      "'저장' 버튼을 클릭하여 설정을 저장합니다.",
    ],
    images: [{ src: "/manual/05-settings.png", alt: "설정 화면" }],
    usage:
      "API 토큰은 Dooray 구성원 가져오기에 사용됩니다. 본인 인증을 완료하면 가이드 Q&A 답변 시 Dooray 1:1 메시지로 알림을 받을 수 있습니다. 시스템 토큰이 설정되어 있으면 개인 토큰 없이도 일부 기능을 사용할 수 있으나, 개인 토큰을 설정하면 우선 적용됩니다.",
    warning:
      "'프로젝트 불러오기'와 '구성원 불러오기'는 사내 VPN이 연결된 상태에서, Inje Chrome Extension이 설치된 브라우저에서만 동작합니다.",
  },
  {
    id: "food",
    title: "5. 오늘 뭐 먹지?",
    description:
      "현재 위치 주변의 음식점/카페를 검색하고 랜덤 추천을 받을 수 있습니다. Kakao 지도 API를 활용합니다.",
    steps: [
      "첫 방문 시 '현재 위치' 또는 '주소 검색'으로 위치를 설정합니다.",
      "주소 검색: 주소나 장소명을 입력하고 검색 결과에서 원하는 위치를 선택합니다.",
      "위치 설정 후 검색 바에서 음식점/카페 이름으로 검색하거나, 카테고리 필터(전체/음식점/카페)를 사용합니다.",
      "'랜덤 추천' 버튼을 누르면 주변 음식점 중 하나를 무작위로 추천합니다.",
      "필터: 반경(500m~2km), 세부 카테고리, 최대 검색 건수를 조절할 수 있습니다.",
      "검색 결과에서 카카오맵 링크(외부 열기)와 즐겨찾기 버튼을 사용할 수 있습니다.",
    ],
    images: [
      { src: "/manual/06-food-init.png", alt: "위치 설정 전" },
      { src: "/manual/07-food-address.png", alt: "주소 검색" },
      { src: "/manual/08-food-main.png", alt: "위치 설정 후 메인" },
      { src: "/manual/09-food-results.png", alt: "검색 결과" },
    ],
    usage:
      "'너로 정했어' 이후 Dooray 메시지 전송 기능은 일반 인터넷 환경에서도 사용 가능합니다. 단, 사전에 'Dooray에서 가져오기'로 구성원을 한 번 이상 불러온 적이 있어야 합니다.",
  },
  {
    id: "guide",
    title: "6. 이럴때는 어떻게 하지? (가이드 Q&A)",
    description:
      "사내 규정, 가이드 문서에 대해 AI에게 질문하고 답변을 받을 수 있습니다. Google NotebookLM 기반으로 동작합니다.",
    steps: [
      "가이드 페이지에 접속하면 등록된 노트북(가이드 문서)의 채팅 화면이 표시됩니다.",
      "하단 입력창에 궁금한 내용을 자연어로 질문합니다. (Enter로 전송, Shift+Enter로 줄바꿈)",
      "AI가 등록된 가이드 문서를 기반으로 답변을 생성합니다.",
      "답변 하단의 '참고 자료'를 클릭하면 답변의 근거가 된 원본 문서 내용을 확인할 수 있습니다.",
      "'소스' 버튼을 클릭하면 현재 노트북에 등록된 소스 문서 목록을 확인할 수 있습니다.",
      "설정에서 본인 인증을 완료하면, 답변이 도착할 때 Dooray 1:1 메시지로 알림을 받습니다.",
    ],
    images: [{ src: "/manual/10-guide.png", alt: "가이드 Q&A 화면" }],
  },
  {
    id: "ladder",
    title: "7. 사다리 게임",
    description:
      "참여자와 결과(상/벌)를 매칭하는 사다리 게임입니다. 애니메이션과 BGM으로 즐거운 경험을 제공합니다.",
    steps: [
      "참여자 명단: 이름을 직접 입력하거나, 'Dooray에서 가져오기'로 프로젝트 구성원을 불러옵니다.",
      "게임 설정: 결과 항목을 상(초록)/벌(빨강)/일반으로 구분하여 추가합니다. '상벌 불러오기'로 이전 설정을 재사용할 수 있습니다.",
      "다리 밀도(40% 기본)와 배경음악(긴장감/신나는/잔잔한)을 설정합니다.",
      "'사다리 만들기'를 클릭하면 사다리가 생성됩니다.",
      "참여자 이름을 클릭하면 애니메이션과 함께 결과가 표시됩니다.",
      "하단의 '사다리 게임 이력'에서 이전 게임 결과를 확인할 수 있습니다.",
    ],
    images: [{ src: "/manual/11-ladder.png", alt: "사다리 게임 화면" }],
    warning:
      "'Dooray에서 가져오기'는 사내 VPN이 연결된 상태에서, Inje Chrome Extension이 설치된 브라우저에서만 동작합니다. 직접 이름을 입력하거나 '내 구성원'을 사용하면 VPN 없이도 이용 가능합니다.",
  },
  {
    id: "team",
    title: "8. 커피 타임 (팀 구성)",
    description:
      "참여자를 랜덤으로 팀에 배정합니다. 커피 타임, 회식 조 편성 등 다양한 용도로 사용할 수 있습니다.",
    steps: [
      "참여자 명단: 이름을 직접 입력하거나, 'Dooray에서 가져오기'로 구성원을 불러옵니다. '내 구성원' 버튼으로 저장된 구성원을 빠르게 추가할 수 있습니다.",
      "팀 설정: 팀 수, 팀별 최소/최대 인원을 설정합니다.",
      "'법카 소지자 팀별 균등 분배' 옵션을 체크하면 법인카드 소지자가 각 팀에 골고루 배정됩니다.",
      "'팀 구성하기'를 클릭하면 랜덤으로 팀이 배정됩니다.",
      "결과는 Dooray 메신저로 공유할 수 있으며, 하단에서 이전 팀 구성 이력을 확인할 수 있습니다.",
    ],
    images: [{ src: "/manual/12-team.png", alt: "커피 타임 화면" }],
    warning:
      "'Dooray에서 가져오기'는 사내 VPN이 연결된 상태에서, Inje Chrome Extension이 설치된 브라우저에서만 동작합니다. 직접 이름을 입력하거나 '내 구성원'을 사용하면 VPN 없이도 이용 가능합니다.",
  },
];

export default function ManualPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold tracking-tight">
            NHN InjeInc 사용자 매뉴얼
          </h1>
          <p className="text-muted-foreground mt-2">
            인재인을 위한 서비스 사용 가이드
          </p>
        </div>

        {/* TOC */}
        <nav className="mb-12 p-6 rounded-xl border bg-card">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            목차
          </h2>
          <ol className="space-y-1.5">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="text-sm text-primary hover:underline"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* Sections */}
        <div className="space-y-16">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-20">
              <h2 className="text-2xl font-bold mb-2 pb-2 border-b">
                {section.title}
              </h2>
              <p className="text-muted-foreground mb-6">
                {section.description}
              </p>

              {/* Steps */}
              <div className="mb-6">
                <ol className="space-y-2">
                  {section.steps.map((step, i) => (
                    <li key={i} className="flex gap-3 items-start">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Warning */}
              {section.warning && (
                <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-300 dark:bg-amber-950/30 dark:border-amber-700">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    <span className="font-semibold">⚠️ 주의:</span>{" "}
                    {section.warning}
                  </p>
                </div>
              )}

              {/* Usage info */}
              {section.usage && (
                <div className="mb-6 p-4 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <span className="font-semibold">💡 활용:</span>{" "}
                    {section.usage}
                  </p>
                </div>
              )}

              {/* Images */}
              <div className="space-y-4">
                {section.images.map((img, i) => (
                  <figure
                    key={i}
                    className="rounded-xl border overflow-hidden bg-card shadow-sm"
                  >
                    <Image
                      src={img.src}
                      alt={img.alt}
                      width={1200}
                      height={675}
                      className="w-full h-auto"
                    />
                    <figcaption className="text-xs text-muted-foreground text-center py-2 bg-muted/30">
                      {img.alt}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t text-center text-xs text-muted-foreground">
          <p>NHN InjeInc Workshop &copy; 2026</p>
        </div>
      </div>
    </div>
  );
}
