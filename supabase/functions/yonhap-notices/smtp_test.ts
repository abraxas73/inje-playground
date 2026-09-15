import { buildMessage, dotStuff, encodeHeaderWord, sanitize, sendMail, SmtpError, smtpConfigFromEnv, type Transport } from "./smtp.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)));
const decodeWord = (word: string) => dec.decode(Uint8Array.from(atob(word.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, "")), (c) => c.charCodeAt(0)));

/** Scripted SMTPS peer: replies are queued by write(), consumed by read(). */
class FakeServer implements Transport {
  commands: string[] = []; data = ""; closed = false;
  private inData = false; private inbox = ""; private outbox: Uint8Array[] = [];
  constructor(private options: { rejects?: Record<string, number>; authCode?: number; silentAfterBanner?: boolean } = {}) { this.queue("220 test.local ESMTP ready"); }
  private queue(line: string) { this.outbox.push(enc.encode(`${line}\r\n`)); }
  read(p: Uint8Array): Promise<number | null> {
    const next = this.outbox.shift();
    if (!next) return new Promise(() => {});
    p.set(next); return Promise.resolve(next.length);
  }
  write(p: Uint8Array): Promise<number> {
    this.inbox += dec.decode(p);
    let index: number;
    while ((index = this.inbox.indexOf("\r\n")) >= 0) {
      const line = this.inbox.slice(0, index); this.inbox = this.inbox.slice(index + 2);
      if (this.inData) { if (line === ".") { this.inData = false; this.queue("250 2.0.0 queued as ABC123"); } else this.data += `${line}\r\n`; continue; }
      this.commands.push(line);
      if (this.options.silentAfterBanner) continue;
      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO")) { this.queue("250-test.local"); this.queue("250-AUTH LOGIN PLAIN"); this.queue("250 HELP"); }
      else if (upper === "AUTH LOGIN") this.queue("334 VXNlcm5hbWU6");
      else if (this.commands.at(-2)?.toUpperCase() === "AUTH LOGIN") this.queue("334 UGFzc3dvcmQ6");
      else if (this.commands.at(-3)?.toUpperCase() === "AUTH LOGIN") {
        const code = this.options.authCode ?? 235;
        this.queue(code === 235 ? "235 2.7.0 Authentication successful" : `${code} 5.7.8 Authentication credentials invalid for sender@example.test`);
      }
      else if (upper.startsWith("MAIL FROM")) this.queue("250 2.1.0 Ok");
      else if (upper.startsWith("RCPT TO")) { const address = line.slice(line.indexOf("<") + 1, line.indexOf(">")); const code = this.options.rejects?.[address]; this.queue(code ? `${code} 5.1.1 <${address}>: Recipient address rejected` : "250 2.1.5 Ok"); }
      else if (upper === "DATA") { this.inData = true; this.queue("354 End data with <CR><LF>.<CR><LF>"); }
      else if (upper === "QUIT") this.queue("221 2.0.0 Bye");
      else this.queue("500 5.5.1 Unknown command");
    }
    return Promise.resolve(p.length);
  }
  close() { this.closed = true; }
}
const config = { host: "relay.test", port: 465, user: "sender@example.test", pass: "p@ss#word" };
const message = { from: { name: "인사·부고 알림", address: "sender@example.test" }, to: ["a@example.test", "b@example.test"], subject: "[부고 알림] 관리 매체·부서 일치 2건 · 9월 15일", text: "본문\n.숨은 점\n", html: "<p>본문</p>" };
const send = (server: FakeServer, overrides: Partial<typeof message> = {}, options: { stepTimeoutMs?: number } = {}) =>
  sendMail(config, { ...message, ...overrides }, { connect: () => Promise.resolve(server), now: () => new Date("2026-09-15T02:00:00Z"), messageId: "test-id@example.test", ...options });

Deno.test("authenticates with AUTH LOGIN over the injected TLS transport and delivers one message", async () => {
  const server = new FakeServer();
  const result = await send(server);
  assert(result.accepted.length === 2 && result.rejected.length === 0 && result.messageId === "test-id@example.test");
  assert(server.commands[0].startsWith("EHLO "), "EHLO first");
  assert(server.commands.includes("AUTH LOGIN") && server.commands.includes(b64(config.user)) && server.commands.includes(b64(config.pass)), "credentials base64");
  assert(server.commands.includes("MAIL FROM:<sender@example.test>") && server.commands.includes("RCPT TO:<a@example.test>") && server.commands.includes("RCPT TO:<b@example.test>"));
  assert(server.commands.filter((c) => c === "DATA").length === 1 && server.commands.at(-1) === "QUIT" && server.closed);
  assert(server.data.includes("Date: Tue, 15 Sep 2026 02:00:00 +0000") && server.data.includes("Message-ID: <test-id@example.test>"), "headers");
  assert(server.data.includes("Content-Type: multipart/alternative") && server.data.includes("Content-Transfer-Encoding: base64"));
  const subjectLine = server.data.split("\r\n").find((l) => l.startsWith("Subject: "))!;
  assert(subjectLine.split(" ").slice(1).map(decodeWord).join("") === message.subject, "subject round-trips through RFC 2047");
  assert(!server.data.includes(config.pass) && !server.data.includes("\n.숨은"), "no raw secrets or bare dots");
});

Deno.test("records rejected recipients per RCPT reply and still sends to accepted ones", async () => {
  const server = new FakeServer({ rejects: { "b@example.test": 550 } });
  const result = await send(server);
  assert(result.accepted.length === 1 && result.accepted[0] === "a@example.test");
  assert(result.rejected.length === 1 && result.rejected[0].address === "b@example.test" && result.rejected[0].code === 550);
  assert(server.commands.includes("DATA"));
});

Deno.test("skips DATA when every recipient is rejected", async () => {
  const server = new FakeServer({ rejects: { "a@example.test": 550, "b@example.test": 551 } });
  const result = await send(server);
  assert(result.accepted.length === 0 && result.rejected.length === 2 && !server.commands.includes("DATA") && server.closed);
});

Deno.test("authentication failure surfaces step and code without addresses or secrets", async () => {
  const server = new FakeServer({ authCode: 535 });
  try { await send(server); throw new Error("expected failure"); }
  catch (error) {
    assert(error instanceof SmtpError && error.step === "auth" && error.code === 535, `unexpected ${String(error)}`);
    assert(!error.message.includes("sender@example.test") && error.message.includes("[email]") && !error.message.includes(config.pass));
  }
  assert(!server.commands.some((c) => c.startsWith("MAIL FROM")) && server.closed);
});

Deno.test("times out when the server stops answering and closes the connection", async () => {
  const server = new FakeServer({ silentAfterBanner: true });
  try { await send(server, {}, { stepTimeoutMs: 30 }); throw new Error("expected timeout"); }
  catch (error) { assert(error instanceof SmtpError && error.step === "ehlo" && error.message.includes("timeout"), String(error)); }
  assert(server.closed);
});

Deno.test("rejects malformed addresses before connecting", async () => {
  const server = new FakeServer();
  for (const bad of ["a@b", "x y@example.test", "<a@example.test>", "a@example.test\r\nRCPT TO:<z@example.test>"]) {
    try { await send(server, { to: [bad] }); throw new Error("accepted " + bad); }
    catch (error) { assert(error instanceof SmtpError && error.step === "recipient", String(error)); }
  }
  assert(server.commands.length === 0);
});

Deno.test("header words, dot stuffing and sanitize", () => {
  assert(encodeHeaderWord("Plain ASCII subject") === "Plain ASCII subject");
  const long = encodeHeaderWord("가".repeat(40));
  assert(long.split(" ").every((w) => w.length <= 75 && w.startsWith("=?UTF-8?B?")) && long.split(" ").map(decodeWord).join("") === "가".repeat(40));
  assert(dotStuff("abc\r\n.hidden\r\n..x\r\nend") === "abc\r\n..hidden\r\n...x\r\nend");
  assert(sanitize("550 <who@example.test> rejected\r\nsecond line") === "550 <[email]> rejected second line");
  assert(sanitize("x".repeat(300)).length === 200);
  const built = buildMessage({ ...message, to: ["a@example.test"] }, "id@example.test", new Date("2026-09-15T02:00:00Z"));
  assert(built.includes("From: =?UTF-8?B?") && built.includes("<sender@example.test>") && built.includes("To: <a@example.test>") && built.endsWith("--\r\n"));
  assert(smtpConfigFromEnv(() => undefined) === null);
  const cfg = smtpConfigFromEnv((k) => ({ MEDIA_SMTP_HOST: "h", MEDIA_SMTP_USER: "u@x.test", MEDIA_SMTP_PASS: "p" } as Record<string, string>)[k]);
  assert(cfg?.port === 465 && cfg.host === "h");
});
