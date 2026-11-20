"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type PromptSurvey = { slug: string; title: string; anonymous?: boolean };

const SKIP = /^\/(survey|login|auth)(\/|$)/;
const seenKey = (slug: string) => `survey_prompt_later:${slug}`;

/**
 * 관리자가 '로그인 시 팝업'을 켠 진행 중 설문을 아직 참여하지 않았으면 띄운다(웹 브라우저 — 앱 WebView 안은 앱이 띄운다).
 * '나중에'는 이 브라우저 세션 동안만 다시 띄우지 않는다 — 다음 로그인(새 세션)에 다시 뜬다.
 */
export default function SurveyLoginPrompt() {
  const pathname = usePathname();
  const router = useRouter();
  const checked = useRef(false);
  const [survey, setSurvey] = useState<PromptSurvey | null>(null);

  useEffect(() => {
    if (checked.current || SKIP.test(pathname ?? "")) return;
    checked.current = true;
    (async () => {
      try {
        const res = await fetch("/api/surveys/login-prompt");
        if (!res.ok) return;
        const { survey: s } = (await res.json()) as { survey: PromptSurvey | null };
        if (!s) return;
        try {
          if (sessionStorage.getItem(seenKey(s.slug))) return;
        } catch {}
        setSurvey(s);
      } catch {}
    })();
  }, [pathname]);

  const later = () => {
    if (survey) {
      try {
        sessionStorage.setItem(seenKey(survey.slug), "1");
      } catch {}
    }
    setSurvey(null);
  };

  return (
    <Dialog open={survey !== null} onOpenChange={(o) => !o && later()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>설문 참여 요청</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{survey?.title}</span>
            <br />
            잠시 시간을 내어 참여해 주세요.{survey?.anonymous ? " 응답은 익명으로 집계됩니다." : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={later}>나중에</Button>
          <Button
            onClick={() => {
              const slug = survey?.slug;
              setSurvey(null);
              if (slug) router.push(`/survey/${slug}`);
            }}
          >
            참여하기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
