import { CHECK_LABELS, type CheckState, type EmailAttemptResult, type Evidence } from "@/lib/marketing/email/types";
import { date } from "./shared";

export function EmailBadge({ value }: { value?: CheckState }) {
  return <span className={`inline-block rounded px-2 py-1 text-xs whitespace-nowrap ${value === "fail" || value === "error" ? "bg-red-50 text-red-700" : value === "pass" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{value ? CHECK_LABELS[value] : "미처리"}</span>;
}
function Check({ label, value }: { label: string; value?: Evidence }) {
  return <article className="rounded-lg border p-3 space-y-2"><div className="flex justify-between gap-3"><h4 className="text-sm font-semibold">{label}</h4><EmailBadge value={value?.state}/></div><p className="text-sm">{value?.message ?? "실행 오류 또는 미처리 상태입니다."}</p></article>;
}
function SafeLink({ url }: { url?: string }) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return <a className="text-primary underline break-all" href={url} target="_blank" rel="noopener noreferrer">{url}</a>;
}
export default function EmailEvidence({ result }: { result: EmailAttemptResult | null }) {
  return <div className="space-y-3">
    {result?.message && <p className="text-sm text-destructive">{result.message}</p>}
    <Check label="주소 형식" value={result?.syntax}/>
    <Check label="회사 이메일 연관성" value={result?.relationship}/>
    <Check label="메일 수신 도메인" value={result?.mail}/>
    {!!result?.mail?.mx?.length && <p className="text-xs break-all">MX: {result.mail.mx.map(m => `${m.exchange || "."} (우선순위 ${m.priority})`).join(", ")}</p>}
    <Check label="회사 홈페이지" value={result?.website}/>
    {result?.website && <div className="text-xs space-y-2">
      <p>{result.websiteSource === "candidate" ? "이메일 도메인에서 추정한 후보" : "담당자가 등록한 홈페이지"}: <SafeLink url={result.website.url}/></p>
      {result.website.finalUrl && <p>최종 응답: <SafeLink url={result.website.finalUrl}/></p>}
      <p>페이지 제목: {result.website.title || "확인되지 않음"}{result.website.status ? ` · HTTP ${result.website.status}` : ""}</p>
      <p>회사명 문자열: {result.companyMentioned ? "발견됨 (보조 근거)" : "확인되지 않음"} · 공식성·법인 실존을 확정하는 근거는 아닙니다.</p>
      <p>홈페이지 확인: {result.website.checkedAt ? date(result.website.checkedAt) : "—"} · DNS 확인: {result.mail?.checkedAt ? date(result.mail.checkedAt) : "—"}</p>
    </div>}
    <Check label="개별 메일함 실제 존재" value={result?.mailbox}/>
    <p className="text-xs text-muted-foreground">개별 메일함의 실제 존재·수신 성공은 미확인입니다. 검사 메일은 발송하지 않습니다.</p>
  </div>;
}
