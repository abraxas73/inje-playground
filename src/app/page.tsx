import Link from "next/link";

const FEATURES = [
  {
    href: "/ladder",
    title: "사다리 게임",
    description:
      "참여자와 결과를 매칭하는 사다리 게임. 애니메이션과 함께 결과를 확인하세요.",
    icon: "🪜",
  },
  {
    href: "/team",
    title: "팀 나누기",
    description: "참여자를 원하는 조건에 맞게 랜덤으로 팀을 구성합니다.",
    icon: "👥",
  },
  {
    href: "/settings",
    title: "설정",
    description: "Dooray 연동 설정으로 프로젝트 멤버를 자동으로 불러옵니다.",
    icon: "⚙️",
  },
];

export default function HomePage() {
  return (
    <div className="py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-slate-900 mb-3">
          Coneplus Workshop
        </h1>
        <p className="text-slate-600 text-lg">
          팀 워크샵을 위한 게임 & 유틸리티
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {FEATURES.map((feature) => (
          <Link
            key={feature.href}
            href={feature.href}
            className="block p-6 bg-white rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all"
          >
            <div className="text-4xl mb-4">{feature.icon}</div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">
              {feature.title}
            </h2>
            <p className="text-slate-600 text-sm">{feature.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
