import { parseEmail, publicMail, sameSite, websiteUrl } from "./normalize";
import type { EmailSnapshot, EmailResult, MailProbe, WebProbe, Evidence } from "./types";
export const EMAIL_ENGINE = "email-integrity-1";
export function planChecks(snapshot: EmailSnapshot) {
  const syntax = parseEmail(snapshot.email); let website = "";
  try { website = snapshot.profile?.website ? websiteUrl(snapshot.profile.website).href : syntax.domain && !publicMail(syntax.domain) ? `https://${syntax.domain}/` : ""; } catch { /* Invalid saved URL is never fetched. */ }
  return { syntax, website };
}
export function evaluateEmail(snapshot: EmailSnapshot, mail: MailProbe, web: WebProbe): EmailResult {
  const { syntax, website } = planChecks(snapshot);
  const domain = syntax.domain;
  const personal = !!domain && publicMail(domain);
  const approved = !!domain && !!snapshot.profile?.domains.includes(domain);
  let relationship: Evidence = { state: "review", code: "unconfirmed_company", message: "회사별 확인된 이메일 도메인 기준이 없습니다. 홈페이지·업무 근거를 검토해 등록하세요." };
  if (personal) relationship = { state: "review", code: "public_mail", message: "공용 이메일 서비스입니다. 주소만으로 소속 회사를 판단할 수 없습니다." };
  else if (approved) relationship = { state: "pass", code: "approved_domain", message: "담당자가 확인한 회사 이메일 도메인과 정확히 일치합니다." };
  else if (snapshot.profile?.domains.length) relationship = { state: "review", code: "domain_mismatch", message: "확인된 회사 이메일 도메인과 다릅니다. 별도 도메인·퇴사·오입력 여부를 확인하세요." };
  else if (snapshot.profile?.website && domain && sameSite(domain, websiteUrl(snapshot.profile.website).hostname)) relationship = { state: "review", code: "website_domain_match", message: "등록된 홈페이지와 같은 등록 도메인입니다. 회사 이메일 도메인으로 확인 후 등록하세요." };
  const companyKey = snapshot.company.replace(/주식회사|\(주\)|㈜|[^\p{L}\p{N}]/gu, "").toLowerCase();
  const mentioned = companyKey.length >= 2 && (web.text ?? "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase().includes(companyKey);
  const foreignRedirect = !!web.finalUrl && !!website && !sameSite(websiteUrl(website).hostname, websiteUrl(web.finalUrl).hostname);
  const websiteEvidence = { ...web, text: undefined };
  if (foreignRedirect && web.state === "pass") { websiteEvidence.state = "review"; websiteEvidence.code = "different_site"; websiteEvidence.message = "다른 등록 도메인으로 이동합니다. 회사 관계와 이전된 홈페이지인지 확인하세요."; }
  const state = syntax.state === "fail" || mail.state === "fail" ? "fail" : syntax.state === "pass" && relationship.state === "pass" && mail.state === "pass" && websiteEvidence.state === "pass" && !!snapshot.profile?.website ? "pass" : "review";
  return { engine: EMAIL_ENGINE, email: snapshot.email, domain, checkedAt: new Date().toISOString(), state, syntax, relationship, mail, website: websiteEvidence, companyMentioned: mentioned, websiteSource: snapshot.profile?.website ? "approved" : website ? "candidate" : "none", mailbox: { state: "review", code: "unverified", message: "개별 메일함 존재·수신 성공은 미확인입니다. 발송 이력이나 담당자 확인이 필요합니다." } };
}
