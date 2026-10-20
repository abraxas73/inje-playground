import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { bad, caller } from "@/lib/proposal/api";
import { PROFILE_MAX_BYTES, PROPOSAL_BUCKET, profilePath, TEMPLATE_MAX_BYTES, templatePath, uploadExtension } from "@/lib/proposal/core";

export const runtime = "nodejs";

/** POST {fileName, size, kind: profile|template} → 서명 업로드 URL(파일은 서버를 거치지 않고 Storage로) */
export async function POST(request: NextRequest) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const b = (await request.json().catch(() => ({}))) as { fileName?: unknown; size?: unknown; kind?: unknown };
  const kind = b.kind === "profile" || b.kind === "template" ? b.kind : null;
  const size = Number(b.size);
  if (!kind || typeof b.fileName !== "string" || !Number.isFinite(size)) return bad("fileName·size·kind가 필요합니다.");
  const ext = uploadExtension(b.fileName, kind);
  if (!ext) return bad(kind === "profile" ? "일반현황은 .pptx 파일만 올릴 수 있습니다." : "고객사 템플릿은 .pptx·.potx 파일만 올릴 수 있습니다.", 415);
  const max = kind === "profile" ? PROFILE_MAX_BYTES : TEMPLATE_MAX_BYTES;
  if (size <= 0 || size > max) return bad(`파일은 ${max / 1024 / 1024}MB 이하여야 합니다.`);
  const storagePath = kind === "profile" ? profilePath(randomUUID()) : templatePath(randomUUID(), ext);
  const { data, error } = await auth.admin.storage.from(PROPOSAL_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) return bad("업로드 주소를 만들지 못했습니다.", 500);
  return NextResponse.json({ storagePath, token: data.token, signedUrl: data.signedUrl });
}
