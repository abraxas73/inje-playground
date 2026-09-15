import { Resolver } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isPublicAddress, normalizeDomain, websiteUrl } from "./normalize";
import type { MailProbe, WebProbe } from "./types";

const resolver = () => new Resolver({ timeout: 2500, tries: 1 });
const code = (e: unknown) => (e as NodeJS.ErrnoException)?.code ?? "NETWORK_ERROR";
const absent = (e: unknown) => ["ENODATA", "ENOTFOUND"].includes(code(e));
export async function addresses(domain: string) {
  const dns = resolver();
  const replies = await Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]);
  const ips = replies.flatMap(r => r.status === "fulfilled" ? r.value : []);
  const transient = replies.some(r => r.status === "rejected" && !absent(r.reason));
  return { ips, transient };
}
export async function checkMail(domain: string): Promise<MailProbe> {
  const base = { domain, checkedAt: new Date().toISOString() };
  try {
    normalizeDomain(domain);
    let mx: { exchange: string; priority: number }[] = [];
    try { mx = await resolver().resolveMx(domain); }
    catch (e) {
      if (code(e) === "ENOTFOUND") return { ...base, state: "fail", code: "nxdomain", message: "DNS에서 이메일 도메인을 찾지 못했습니다." };
      if (!absent(e)) throw e;
    }
    if (mx.some(x => !x.exchange || x.exchange === ".")) return { ...base, mx, state: mx.length === 1 && mx[0].priority === 0 ? "fail" : "review", code: "null_mx", message: mx.length === 1 && mx[0].priority === 0 ? "이 도메인은 메일을 받지 않는다고 명시했습니다 (Null MX)." : "Null MX와 다른 MX가 혼재하거나 우선순위가 잘못되어 확인이 필요합니다." };
    if (mx.length) {
      const hosts = await Promise.all(mx.slice(0, 10).map(async x => { try { return await addresses(normalizeDomain(x.exchange)); } catch { return { ips: [], transient: false }; } }));
      if (hosts.some(x => x.ips.some(isPublicAddress))) return { ...base, mx, state: "pass", code: "mx", message: "공개 메일 수신 서버(MX)와 서버 주소가 확인됐습니다. 개별 메일함 존재는 확인되지 않았습니다." };
      return { ...base, mx, state: "review", code: "mx_unresolved", message: "MX는 있으나 공개 서버 주소를 확인하지 못했습니다. 일시 장애·설정을 재확인하세요." };
    }
    const fallback = await addresses(domain);
    if (fallback.ips.some(isPublicAddress)) return { ...base, mx, state: "review", code: "implicit_mx", message: "MX는 없지만 A/AAAA 대체 경로가 있습니다. 수신 가능 여부는 추가 확인이 필요합니다." };
    return { ...base, mx, state: fallback.transient ? "review" : "fail", code: fallback.transient ? "dns_temporary" : "no_mail_route", message: fallback.transient ? "DNS 조회가 일시적으로 실패했습니다. 재검사하세요." : "공개 메일 수신 경로(MX 또는 A/AAAA)를 찾지 못했습니다." };
  } catch { return { ...base, state: "review", code: "dns_temporary", message: "DNS 조회를 완료하지 못했습니다. 재검사하세요." }; }
}

// Every hop resolves and pins a public address; the URL host remains the TLS/SNI host.
// No browser cookies, Contact fields, user headers, or mailbox name are transmitted.
export async function publicPage(url: URL, signal: AbortSignal): Promise<{ status: number; location?: string; html: string; contentType: string }> {
  const { ips, transient } = await addresses(url.hostname);
  if (!ips.length || transient || ips.some(ip => !isPublicAddress(ip))) throw new Error("unsafe_or_unresolved_host");
  const ip = ips[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET", agent: false, signal,
      headers: { "User-Agent": "Innogrid-ContactCheck/1.0", Accept: "text/html", "Accept-Encoding": "identity" },
      lookup: (_hostname, options, callback) => {
        const address = { address: ip, family: ip.includes(":") ? 6 : 4 };
        if (options.all) callback(null, [address]); else callback(null, address.address, address.family);
      },
    }, response => {
      const chunks: Buffer[] = []; let bytes = 0; let done = false;
      function finish() { if (done) return; done = true; resolve({ status: response.statusCode ?? 0, location: response.headers.location, contentType: response.headers["content-type"] ?? "", html: Buffer.concat(chunks).toString("utf8") }); }
      response.on("data", (chunk: Buffer) => { const remaining = 131072 - bytes; chunks.push(chunk.subarray(0, remaining)); bytes += chunk.length; if (bytes >= 131072) { finish(); response.destroy(); } });
      response.on("end", finish); response.on("error", e => { if (!done) reject(e); });
    });
    request.on("error", reject); request.end();
  });
}
export async function checkWebsite(input: string, transport = publicPage): Promise<WebProbe> {
  const base = { url: input, checkedAt: new Date().toISOString() };
  const signal = AbortSignal.timeout(12000); const redirects: string[] = [];
  try {
    let url = websiteUrl(input);
    for (let hop = 0; hop < 4; hop++) {
      signal.throwIfAborted();
      const page = await transport(url, signal);
      if ([301, 302, 303, 307, 308].includes(page.status) && page.location) {
        // Do not carry arbitrary redirect query parameters into another request.
        url = websiteUrl(new URL(page.location, url).href); redirects.push(url.href); continue;
      }
      const title = (page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 250);
      const text = page.html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 15000);
      const ok = page.status >= 200 && page.status < 300 && page.contentType.includes("text/html");
      const parked = /domain (is )?(for sale|parked)|buy this domain|도메인 판매/i.test(`${title} ${text.slice(0, 1500)}`);
      return { ...base, finalUrl: url.href, redirects, status: page.status, title, text, state: ok && !parked ? "pass" : "review", code: parked ? "parked" : ok ? "reachable" : "http_review", message: parked ? "도메인 판매·주차 페이지로 보입니다. 회사 홈페이지인지 확인하세요." : ok ? "웹페이지 응답을 확인했습니다. 공식 회사 홈페이지 여부는 별도 근거로 판단합니다." : `HTTP ${page.status} 응답입니다. 차단·장애·페이지 이동 여부를 확인하세요.` };
    }
    return { ...base, redirects, state: "review", code: "redirect_limit", message: "리디렉션이 반복되어 확인하지 못했습니다." };
  } catch { return { ...base, redirects, state: "review", code: "unreachable", message: "공개 홈페이지 접속을 확인하지 못했습니다. 일시 장애·인증서·접근 차단·주소를 재확인하세요." }; }
}
