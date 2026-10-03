import type { Metadata } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Navigation from "@/components/layout/Navigation";
import { isInnogridAppUA } from "@/lib/mobile/app-ua";

const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "이노그리드",
  description: "이노크루를 위한 서비스 — 팀 활동, 일상의 고민을 해결하는 우리만의 도구",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 모바일 앱 WebView(UA `InnogridApp/…`) 안에서는 앱이 상단 바·탭·뒤로가기를 제공하므로 웹의 헤더·하단 탭을 그리지 않는다(서버에서 판별해 깜빡임 없음).
  const inApp = isInnogridAppUA((await headers()).get("user-agent") ?? "");
  return (
    <html lang="ko">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className={`${geistMono.variable} antialiased`} data-app={inApp ? "1" : undefined}>
        <div className="min-h-screen dot-grid">
          <Navigation chromeless={inApp} />
          <main className={inApp ? "max-w-full mx-auto px-4 py-4 pb-8" : "max-w-full mx-auto px-4 md:px-8 py-6 md:py-8 pb-20 md:pb-8"}>{children}</main>
        </div>
      </body>
    </html>
  );
}
