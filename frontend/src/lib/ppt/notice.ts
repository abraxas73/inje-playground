import type { ChannelMessage } from "@/lib/notify/types";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Teams 채널 카드 문구(스펙 §10.2) */
export function buildTeamsNotice(p: { title: string; slides: number | null; no: number; owner: string; shareUrl: string | null; sharepointUrl: string | null }): ChannelMessage {
  const meta = [p.slides ? `${p.slides}장` : null, `v${p.no}`].filter(Boolean).join(", ");
  const lines = [`[PPT] ${p.title} (${meta}) — ${p.owner}`, p.shareUrl ?? "공유 링크가 꺼져 있습니다"];
  if (p.sharepointUrl) lines.push(`SharePoint: ${p.sharepointUrl}`);
  return { title: "PPT 만들기", text: lines.join("\n") };
}
