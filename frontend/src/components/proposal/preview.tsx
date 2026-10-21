"use client";
import { useEffect, useState } from "react";
import { Download, ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase";
import { postJson } from "@/lib/ppt/client";
import { PREVIEW_COUNT, PROPOSAL_BUCKET } from "@/lib/proposal/core";

// PPT에 지정된 글꼴(맑은 고딕 등)이 없으면 SVG 안에서 명조로 떨어져 글자가 겹친다 — 미리보기는 시스템 고딕으로 통일.
const FONT_CSS = `.pptx-render-host *{font-family:"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif !important}`;

/** 앞 3장을 브라우저에서 그려 JPEG로 — 서버에 PPT 렌더러가 없어서 올린 사람 브라우저가 만든다(장당 40~200KB) */
export async function renderPreviews(buf: ArrayBuffer): Promise<Blob[]> {
  const [{ init }, { toBlob }] = await Promise.all([import("pptx-preview"), import("html-to-image")]);
  const host = document.createElement("div");
  host.className = "pptx-render-host";
  host.style.cssText = "position:fixed;left:-10000px;top:0";
  const style = document.createElement("style");
  style.textContent = FONT_CSS;
  host.append(style);
  document.body.append(host);
  const p = init(host, { width: 960, mode: "slide" });
  try {
    await p.load(buf);
    const out: Blob[] = [];
    for (let i = 0; i < Math.min(PREVIEW_COUNT, p.slideCount); i++) {
      p.removeCurrentSlide();
      p.renderSingleSlide(i);
      await new Promise((r) => setTimeout(r, 300)); // 그림·차트가 자리 잡을 때까지
      const slide = host.querySelector<HTMLElement>(".pptx-preview-slide-wrapper");
      const blob = slide && (await toBlob(slide, { type: "image/jpeg", quality: 0.82, pixelRatio: 1, backgroundColor: "#fff" }));
      if (blob) out.push(blob);
    }
    return out;
  } finally {
    p.destroy();
    host.remove();
  }
}

/** 그린 미리보기를 그 버전에 올린다(올린 사람·관리자만 — 서버가 확인) */
export async function uploadPreviews(profileId: string, blobs: Blob[]): Promise<void> {
  if (!blobs.length) return;
  const { tickets } = await postJson<{ tickets: { path: string; token: string }[] }>(`/api/proposal/profiles/${profileId}/previews`, { count: blobs.length });
  const storage = createClient().storage.from(PROPOSAL_BUCKET);
  for (const [i, t] of tickets.entries()) {
    const { error } = await storage.uploadToSignedUrl(t.path, t.token, blobs[i], { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(`미리보기 업로드에 실패했습니다: ${error.message}`);
  }
}

/** 고른 일반현황 버전 — 내려받기 + 앞 3장 미리보기 */
export function ProfilePreview({ profileId }: { profileId: string }) {
  const [state, setState] = useState<{ id: string; urls: string[] } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/proposal/profiles/${profileId}/previews`)
      .then((r) => (r.ok ? r.json() : { urls: [] }))
      .then((j: { urls: string[] }) => { if (alive) setState({ id: profileId, urls: j.urls }); })
      .catch(() => { if (alive) setState({ id: profileId, urls: [] }); });
    return () => { alive = false; };
  }, [profileId]);
  const urls = state?.id === profileId ? state.urls : null;
  return (
    <div className="space-y-2 md:col-span-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">미리보기</span>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <a href={`/api/proposal/profiles/${profileId}/file`}><Download className="mr-1 h-3.5 w-3.5" />PPT 내려받기</a>
        </Button>
      </div>
      {urls === null ? (
        <div className="flex h-24 items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : urls.length ? (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border bg-white hover:ring-2 hover:ring-primary/40" title={`${i + 1}장 크게 보기`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 10분짜리 서명 URL이라 next/image 최적화 대상이 아니다 */}
              <img src={u} alt={`${i + 1}장 미리보기`} className="h-auto w-full" loading="lazy" />
            </a>
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><ImageOff className="h-3.5 w-3.5" />이 버전은 미리보기가 없습니다. 내려받아 확인해 주세요.</p>
      )}
    </div>
  );
}
