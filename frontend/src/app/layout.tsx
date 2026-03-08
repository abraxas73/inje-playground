import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Navigation from "@/components/layout/Navigation";

const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "NHN InjeInc",
  description: "인재인을 위한 서비스 — 팀 활동, 일상의 고민을 해결하는 우리만의 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
      <body className={`${geistMono.variable} antialiased`}>
        <div className="min-h-screen dot-grid">
          <Navigation />
          <main className="max-w-full mx-auto px-4 md:px-8 py-6 md:py-8 pb-20 md:pb-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
