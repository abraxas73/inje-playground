"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dice5, Users, Settings, ArrowRight, UtensilsCrossed, HelpCircle } from "lucide-react";
import { createClient } from "@/lib/supabase";

const SUPER_USER = "abraxas73@gmail.com";

const FEATURES = [
  {
    href: "/ladder",
    title: "사다리 게임",
    description:
      "참여자와 결과를 매칭하는 사다리 게임. 애니메이션과 함께 결과를 확인하세요.",
    icon: Dice5,
    gradient: "from-blue-600 to-indigo-700",
    bgAccent: "bg-blue-50",
    iconColor: "text-blue-600",
    delay: "delay-100",
    superOnly: false,
  },
  {
    href: "/team",
    title: "팀 구성",
    description: "참여자를 원하는 조건에 맞게 랜덤으로 팀을 구성하고 이력을 관리합니다.",
    icon: Users,
    gradient: "from-sky-500 to-blue-600",
    bgAccent: "bg-sky-50",
    iconColor: "text-sky-600",
    delay: "delay-200",
    superOnly: false,
  },
  {
    href: "/food",
    title: "오늘 뭐 먹지?",
    description: "주변 음식점을 검색하고 랜덤 추천을 받아 점심 메뉴 고민을 해결하세요.",
    icon: UtensilsCrossed,
    gradient: "from-amber-500 to-orange-600",
    bgAccent: "bg-amber-50",
    iconColor: "text-amber-600",
    delay: "delay-300",
    superOnly: false,
  },
  {
    href: "/guide",
    title: "이럴때는 어떻게 하지?",
    description: "사내 규정, 가이드에 대해 AI에게 질문하고 답변을 받아보세요.",
    icon: HelpCircle,
    gradient: "from-violet-500 to-purple-600",
    bgAccent: "bg-violet-50",
    iconColor: "text-violet-600",
    delay: "delay-[400ms]",
    superOnly: false,
  },
  {
    href: "/settings",
    title: "설정",
    description: "Dooray 연동 설정으로 프로젝트 멤버를 자동으로 불러옵니다.",
    icon: Settings,
    gradient: "from-slate-500 to-slate-700",
    bgAccent: "bg-slate-100",
    iconColor: "text-slate-600",
    delay: "delay-[500ms]",
    superOnly: true,
  },
];

export default function HomePage() {
  const [isSuperUser, setIsSuperUser] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setIsSuperUser(data.user?.email === SUPER_USER);
    });
  }, []);

  const visibleFeatures = FEATURES.filter((f) => !f.superOnly || isSuperUser);
  return (
    <div className="py-8 md:py-16">
      <div className="text-center mb-10 md:mb-16 animate-fade-up">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          NHN InjeInc
        </div>
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-4">
          <span className="gradient-text">인재인</span>을 위한{" "}
          <span className="text-foreground">서비스</span>
        </h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          팀 활동, 일상의 고민을 해결하는 우리만의 도구
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleFeatures.map((feature) => {
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
