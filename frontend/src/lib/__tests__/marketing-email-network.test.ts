// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const m = vi.hoisted(() => ({ mx: vi.fn(), a: vi.fn(), aaaa: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ Resolver: class { resolveMx = m.mx; resolve4 = m.a; resolve6 = m.aaaa; } }));
vi.mock("node:http", () => ({ request: m.request }));
vi.mock("node:https", () => ({ request: m.request }));
import { checkMail, checkWebsite, publicPage } from "@/lib/marketing/email/network";
import { isPublicAddress, normalizeDomain, parseEmail, publicMail, websiteUrl } from "@/lib/marketing/email/normalize";
import { evaluateEmail } from "@/lib/marketing/email/evaluate";
import type { EmailSnapshot, MailProbe, WebProbe } from "@/lib/marketing/email/types";
const missing = () => Object.assign(new Error("no data"), { code: "ENODATA" });
beforeEach(() => { vi.resetAllMocks(); m.a.mockResolvedValue(["8.8.8.8"]); m.aaaa.mockRejectedValue(missing()); m.mx.mockResolvedValue([{ exchange: "mail.innogrid.com", priority: 10 }]); });
it("normalizes IDNs and excludes IPs, private/special hosts and public suffixes", () => {
 expect(normalizeDomain("INNOGRID.COM.")).toBe("innogrid.com"); expect(normalizeDomain("한국.kr")).toMatch(/^xn--/);
 for (const d of ["127.0.0.1", "co.kr", "localhost", "printer.local", "host.invalid", "example.com", "a..com"]) expect(() => normalizeDomain(d)).toThrow();
 for (const u of ["http://2130706433", "https://user:pass@innogrid.com", "https://innogrid.com:444", "file:///etc/passwd", "http://innogrid.com/?token=private"]) expect(() => websiteUrl(u)).toThrow();
 for (const ip of ["127.0.0.1", "10.2.3.4", "169.254.169.254", "100.64.0.1", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1"]) expect(isPublicAddress(ip), ip).toBe(false);
 expect(isPublicAddress("8.8.8.8")).toBe(true); expect(publicMail("gmail.com")).toBe(true);
});
it("does not reject internationalized or quoted local parts as nonexistent mailboxes", () => {
 expect(parseEmail("홍길동@innogrid.com").state).toBe("review"); expect(parseEmail('"hello world"@innogrid.com').state).toBe("review"); expect(parseEmail("a..b@innogrid.com").state).toBe("fail");
 expect(parseEmail('"a@b"@innogrid.com').state).toBe("review"); expect(parseEmail('"a\nb"@innogrid.com').state).toBe("fail");
});
it("distinguishes MX, Null MX, mixed Null MX, no mail route and temporary DNS errors", async () => {
 expect(await checkMail("innogrid.com")).toMatchObject({ state: "pass", code: "mx" });
 m.mx.mockResolvedValue([{ exchange: "", priority: 0 }]); expect(await checkMail("innogrid.com")).toMatchObject({ state: "fail", code: "null_mx" });
 m.mx.mockResolvedValue([{ exchange: ".", priority: 0 }, { exchange: "mail.innogrid.com", priority: 10 }]); expect((await checkMail("innogrid.com")).state).toBe("review");
 m.mx.mockRejectedValue(missing()); expect(await checkMail("innogrid.com")).toMatchObject({ state: "review", code: "implicit_mx" });
 m.a.mockRejectedValue(missing()); expect(await checkMail("innogrid.com")).toMatchObject({ state: "fail", code: "no_mail_route" });
 m.mx.mockRejectedValue(Object.assign(new Error(), { code: "ETIMEOUT" })); expect((await checkMail("innogrid.com")).state).toBe("review");
 m.mx.mockRejectedValue(Object.assign(new Error(), { code: "ENOTFOUND" })); expect((await checkMail("innogrid.com")).code).toBe("nxdomain");
});
it("blocks mixed public/private answers before any HTTP request", async () => {
 m.a.mockResolvedValue(["8.8.8.8", "10.0.0.1"]); await expect(publicPage(new URL("https://innogrid.com"), AbortSignal.timeout(1000))).rejects.toThrow(); expect(m.request).not.toHaveBeenCalled();
});
it("pins the checked address for the actual socket lookup", async () => {
 m.request.mockImplementation((_url, options, callback) => {
  options.lookup("innogrid.com", { all: false }, (_error: unknown, address: string) => expect(address).toBe("8.8.8.8"));
  const req = new EventEmitter() as EventEmitter & { end: () => void }; req.end = () => { const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { "content-type": "text/html" } }); callback(res); res.emit("data", Buffer.from("<title>이노그리드</title>")); res.emit("end"); }; return req;
 });
 const result = await publicPage(new URL("https://innogrid.com"), AbortSignal.timeout(1000)); expect(result.status).toBe(200); expect(m.a).toHaveBeenCalledTimes(1);
});
it("revalidates every redirect and does not follow private targets", async () => {
 const transport = vi.fn().mockResolvedValue({ status: 302, location: "http://127.0.0.1/admin", html: "", contentType: "text/html" });
 expect((await checkWebsite("https://innogrid.com", transport)).state).toBe("review"); expect(transport).toHaveBeenCalledTimes(1);
});
it("treats 403, parking, and network failure as uncertain; bounds redirects", async () => {
 expect((await checkWebsite("https://innogrid.com", vi.fn().mockResolvedValue({ status: 403, html: "", contentType: "text/html" }))).state).toBe("review");
 expect((await checkWebsite("https://innogrid.com", vi.fn().mockResolvedValue({ status: 200, html: "<title>Buy this domain</title>", contentType: "text/html" }))).code).toBe("parked");
 const redirect = vi.fn().mockResolvedValue({ status: 301, location: "https://innogrid.com/", html: "", contentType: "text/html" }); expect((await checkWebsite("https://innogrid.com", redirect)).code).toBe("redirect_limit"); expect(redirect).toHaveBeenCalledTimes(4);
});
const snapshot: EmailSnapshot = { id: "c1", db_id: "DB1", version: 1, organization_id: "o1", organization_version: 1, company: "이노그리드", name: "담당자", email: "person@innogrid.com", profile: { organization_id: "o1", version: 1, website: "https://www.innogrid.com/", domains: ["innogrid.com"], reason: "공식 홈페이지 확인", actor_name: "검수자", updated_at: "2026-09-15" } };
const mail: MailProbe = { domain: "innogrid.com", checkedAt: "2026-09-15", state: "pass", code: "mx", message: "MX 확인" };
const web: WebProbe = { url: "https://www.innogrid.com/", finalUrl: "https://www.innogrid.com/", checkedAt: "2026-09-15", state: "pass", code: "reachable", message: "HTTP 확인", text: "이노그리드" };
it("approved exact email domains establish company evidence, never mailbox existence", () => {
 const r = evaluateEmail(snapshot, mail, web); expect(r.state).toBe("pass"); expect(r.mailbox.state).toBe("review"); expect(r.companyMentioned).toBe(true); expect(r.website.text).toBeUndefined();
 expect(evaluateEmail({ ...snapshot, email: "person@sub.innogrid.com" }, mail, web).relationship.code).toBe("domain_mismatch");
 expect(evaluateEmail({ ...snapshot, profile: null }, mail, web).state).toBe("review");
 expect(evaluateEmail({ ...snapshot, email: "person@gmail.com" }, mail, web).relationship.code).toBe("public_mail");
 expect(evaluateEmail(snapshot, mail, { ...web, finalUrl: "https://naver.com/" }).website.state).toBe("review");
});
