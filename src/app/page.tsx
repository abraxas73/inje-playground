import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dice5, Users, Settings, ArrowRight } from "lucide-react";

const FEATURES = [
  {
    href: "/ladder",
    title: "사다리 게임",
    description:
      "참여자와 결과를 매칭하는 사다리 게임. 애니메이션과 함께 결과를 확인하세요.",
    icon: Dice5,
    gradient: "from-violet-500 to-indigo-600",
    bgAccent: "bg-violet-50",
    iconColor: "text-violet-600",
    delay: "delay-100",
  },
  {
    href: "/team",
    title: "팀 나누기",
    description: "참여자를 원하는 조건에 맞게 랜덤으로 팀을 구성합니다.",
    icon: Users,
    gradient: "from-emerald-500 to-teal-600",
    bgAccent: "bg-emerald-50",
    iconColor: "text-emerald-600",
    delay: "delay-200",
  },
  {
    href: "/settings",
    title: "설정",
    description: "Dooray 연동 설정으로 프로젝트 멤버를 자동으로 불러옵니다.",
    icon: Settings,
    gradient: "from-amber-500 to-orange-600",
    bgAccent: "bg-amber-50",
    iconColor: "text-amber-600",
    delay: "delay-300",
  },
];

export default function HomePage() {
  return (
    <div className="py-16">
      <div className="text-center mb-16 animate-fade-up">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Workshop Toolkit
        </div>
        <h1 className="text-5xl font-extrabold tracking-tight mb-4">
          <span className="gradient-text">Coneplus</span>{" "}
          <span className="text-foreground">Workshop</span>
        </h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          팀 워크샵을 위한 게임 & 유틸리티
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <Link key={feature.href} href={feature.href} className={`animate-fade-up ${feature.delay}`}>
              <Card className="group h-full hover-glow cursor-pointer overflow-hidden relative">
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-[0.03] transition-opacity duration-500`} />
                <CardHeader className="relative">
                  <div className={`h-12 w-12 rounded-xl ${feature.bgAccent} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300`}>
                    <Icon className={`h-6 w-6 ${feature.iconColor}`} />
                  </div>
                  <CardTitle className="flex items-center justify-between">
                    {feature.title}
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                  </CardTitle>
                  <CardDescription className="leading-relaxed">{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
