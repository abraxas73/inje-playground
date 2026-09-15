import { domainToASCII } from "node:url";
import { parse } from "tldts";
import ipaddr from "ipaddr.js";

const PUBLIC_MAIL = new Set("gmail.com googlemail.com naver.com daum.net hanmail.net nate.com yahoo.com yahoo.co.kr outlook.com hotmail.com live.com msn.com icloud.com me.com mac.com aol.com proton.me protonmail.com kakao.com mail.com fastmail.com hey.com qq.com 163.com 126.com".split(" "));
export function publicMail(domain: string) { return PUBLIC_MAIL.has(domain) || PUBLIC_MAIL.has(parse(domain, { allowPrivateDomains: true }).domain ?? ""); }
export function normalizeDomain(input: string): string {
  const value = domainToASCII(input.trim().toLowerCase().replace(/\.$/, ""));
  const parsed = parse(value, { allowPrivateDomains: true, detectSpecialUse: true });
  if (!value || value.length > 253 || !value.split(".").every(x => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x)) || !parsed.domain || parsed.isIp || parsed.isSpecialUse || (!parsed.isIcann && !parsed.isPrivate)) throw new Error("공개 인터넷 도메인을 입력해 주세요.");
  return value;
}
export function websiteUrl(input: string): URL {
  const url = new URL(input.includes("://") ? input.trim() : `https://${input.trim()}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash || url.href.length > 500) throw new Error("홈페이지는 인증정보·포트·검색 매개변수가 없는 HTTP(S) 주소여야 합니다.");
  url.hostname = normalizeDomain(url.hostname);
  return url;
}
export function isPublicAddress(value: string) {
  try { return ipaddr.parse(value).range() === "unicast"; } catch { return false; }
}
export function sameSite(a: string, b: string) { return parse(a, { allowPrivateDomains: true }).domain === parse(b, { allowPrivateDomains: true }).domain; }
export function parseEmail(email: string) {
  const value = email.trim(); const at = value.lastIndexOf("@");
  const quoted = /^".*"$/.test(value.slice(0, at));
  if (at <= 0 || value.length > 254 || /[\x00-\x1F\x7F]/.test(value) || (!quoted && value.indexOf("@") !== at)) return { domain: "", state: "fail" as const, code: "invalid_email", message: "이메일 주소 형식을 확인하세요." };
  let domain = "";
  try { domain = normalizeDomain(value.slice(at + 1)); } catch { return { domain: "", state: "fail" as const, code: "invalid_domain", message: "공개 이메일 도메인 형식이 올바르지 않습니다." }; }
  const local = value.slice(0, at);
  if (local.length > 64) return { domain, state: "fail" as const, code: "invalid_local", message: "이메일 사용자 부분의 길이를 확인하세요." };
  if (/[^\x00-\x7F]/.test(local) || /^".*"$/.test(local)) return { domain, state: "review" as const, code: "extended_syntax", message: "국제화·인용 이메일 형식은 별도 확인이 필요합니다." };
  const valid = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local);
  return { domain, state: valid ? "pass" as const : "fail" as const, code: valid ? "valid_syntax" : "invalid_local", message: valid ? "이메일 주소 형식 확인" : "이메일 사용자 부분의 형식을 확인하세요." };
}
