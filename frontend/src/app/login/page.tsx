"use client";

import Image from "next/image";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { logAuthEvent } from "@/lib/action-log";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function LoginPage() {
  // 구글 로그인은 기본 숨김(2026-08-31 요청) — 필요 시 /login?google=1 로 표시
  const [showGoogle] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("google") === "1");
  // ?next= 는 같은 오리진 경로만 OAuth 콜백에 전달
  const callbackUrl = () => {
    const next = new URLSearchParams(window.location.search).get("next");
    const safeNext = next && /^\/(?!\/)/.test(next) ? next : null;
    return `${window.location.origin}/auth/callback${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`;
  };
  const handleGoogleLogin = async () => {
    // 리다이렉트 전에 시도를 남긴다(실패해도 로그인은 계속 진행)
    await logAuthEvent("attempt", "google");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl(),
      },
    });
    if (error) await logAuthEvent("failure", "google", error.message);
  };

  const handleMsLogin = async () => {
    await logAuthEvent("attempt", "azure");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email openid profile",
        redirectTo: callbackUrl(),
      },
    });
    if (error) await logAuthEvent("failure", "azure", error.message);
  };

  return (
    <div className="min-h-screen grid grid-rows-[auto_1fr] lg:grid-rows-1 lg:grid-cols-2">
      <Hero />
      <div className="flex flex-col items-center justify-start lg:justify-center dot-grid px-4 py-10">
      <Card className="w-full max-w-sm animate-fade-up">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <Image src="/logo.svg" alt="이노그리드" width={130} height={18} priority />
          </div>
          <CardTitle className="text-lg">반가워요, 이노크루!</CardTitle>
          <CardDescription>회사 Microsoft 계정으로 로그인하세요</CardDescription>
        </CardHeader>
        <CardContent>
          {showGoogle && (
          <Button
            onClick={handleGoogleLogin}
            variant="outline"
            className="w-full h-11 text-sm font-medium"
          >
            <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Google로 로그인
          </Button>
          )}
          <Button
            onClick={handleMsLogin}
            variant="outline"
            className={`w-full h-11 text-sm font-medium${showGoogle ? " mt-2" : ""}`}
          >
            <svg className="h-5 w-5 mr-2" viewBox="0 0 23 23">
              <path fill="#F25022" d="M1 1h10v10H1z" />
              <path fill="#7FBA00" d="M12 1h10v10H12z" />
              <path fill="#00A4EF" d="M1 12h10v10H1z" />
              <path fill="#FFB900" d="M12 12h10v10H12z" />
            </svg>
            Microsoft 계정으로 로그인
          </Button>
        </CardContent>
      </Card>
      <p className="mt-6 text-xs text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground hover:underline">
          개인정보처리방침
        </Link>
      </p>
      </div>
    </div>
  );
}

/** 이노그리드 캐릭터(홍보센터 www.innogrid.com/pr/character) — 이노크루 다섯 친구. 위치는 넓은 화면 무대 기준 %. */
const CREW = [
  { src: "/characters/innobot.png", name: "이노봇", w: 367, h: 323, cls: "left-[34%] top-[30%] w-[34%]", delay: "0s" },
  { src: "/characters/clara.png", name: "클라라", w: 390, h: 301, cls: "left-[4%] top-[8%] w-[30%]", delay: "0.6s" },
  { src: "/characters/udy.png", name: "우디", w: 370, h: 334, cls: "right-[4%] top-[4%] w-[28%]", delay: "1.2s" },
  { src: "/characters/louduck.png", name: "라우덕", w: 527, h: 321, cls: "left-[2%] bottom-[6%] w-[36%]", delay: "1.8s" },
  { src: "/characters/gri.png", name: "그리", w: 218, h: 238, cls: "right-[10%] bottom-[10%] w-[18%]", delay: "2.4s" },
];

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary to-[oklch(0.42_0.22_264)] text-primary-foreground px-6 pt-8 pb-6 lg:p-12 flex flex-col">
      <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -left-16 bottom-0 size-56 rounded-full bg-white/10 blur-2xl" />
      <Image src="/logo-white.svg" alt="이노그리드" width={110} height={15} className="relative" />
      <div className="relative mt-6 lg:mt-16 max-w-md animate-fade-up">
        <p className="text-xs font-semibold tracking-[0.2em] text-white/70">INNO CREW</p>
        <h1 className="mt-2 text-2xl lg:text-4xl font-bold leading-tight">
          이노크루의 하루를
          <br />
          조금 더 가볍게
        </h1>
        <p className="mt-3 text-sm lg:text-base text-white/80">
          점심 메뉴부터 팀 나누기, 사내 가이드, PPT 만들기까지 — 이노크루를 위한 도구를 한곳에 모았어요.
        </p>
      </div>
      {/* 휴대폰: 한 줄 / 넓은 화면: 무대 위에 흩어져 둥실 */}
      <div className="relative mt-5 flex items-end justify-center gap-1.5 lg:hidden" aria-hidden>
        {CREW.map((c, i) => (
          <Image key={c.name} src={c.src} alt="" width={c.w} height={c.h} className="h-11 w-auto animate-float drop-shadow-lg" style={{ animationDelay: `${i * 0.5}s` }} />
        ))}
      </div>
      <div className="relative hidden lg:block flex-1 mt-8 min-h-[320px]">
        {CREW.map((c) => (
          <Image key={c.name} src={c.src} alt={c.name} title={c.name} width={c.w} height={c.h} className={`absolute h-auto animate-float drop-shadow-2xl ${c.cls}`} style={{ animationDelay: c.delay }} />
        ))}
      </div>
      <p className="relative mt-4 hidden lg:block text-xs text-white/60">이노봇 · 클라라 · 우디 · 라우덕 · 그리 — 이노그리드 캐릭터 이노크루</p>
    </section>
  );
}
