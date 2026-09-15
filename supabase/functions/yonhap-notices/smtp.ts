// Minimal SMTP client for the Supabase Edge runtime: implicit TLS (SMTPS, port 465),
// AUTH LOGIN, one message per session. Credentials, recipient addresses and message
// bodies never appear in thrown errors; callers may log SmtpError messages as-is.

export interface SmtpConfig { host: string; port: number; user: string; pass: string }
export interface MailAddress { name?: string; address: string }
export interface MailMessage { from: MailAddress; to: string[]; subject: string; text: string; html: string }
export interface SendResult { accepted: string[]; rejected: Array<{ address: string; code: number }>; messageId: string }
/** Structural subset of Deno.Conn so tests can inject an in-memory transport. */
export interface Transport { read(p: Uint8Array): Promise<number | null>; write(p: Uint8Array): Promise<number>; close(): void }
export type Connect = (host: string, port: number) => Promise<Transport>;
export interface SendOptions {
  connect?: Connect;
  clientName?: string;
  stepTimeoutMs?: number;
  totalTimeoutMs?: number;
  now?: () => Date;
  messageId?: string;
}

const ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g;

/** Strip addresses and line breaks from server text before it reaches logs or the DB. */
export function sanitize(text: string): string {
  return text.replace(EMAIL_PATTERN, "[email]").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}

export class SmtpError extends Error {
  constructor(readonly step: string, readonly code: number | null, detail = "") {
    super(`SMTP ${step} 실패${code === null ? "" : ` (${code})`}${detail ? `: ${sanitize(detail)}` : ""}`);
    this.name = "SmtpError";
  }
}

export function smtpConfigFromEnv(get: (key: string) => string | undefined): SmtpConfig | null {
  const host = get("MEDIA_SMTP_HOST")?.trim(), user = get("MEDIA_SMTP_USER")?.trim(), pass = get("MEDIA_SMTP_PASS");
  const port = Number(get("MEDIA_SMTP_PORT") ?? "465");
  if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, user, pass };
}

const encoder = new TextEncoder();

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const base64Text = (text: string) => base64(encoder.encode(text));
const wrap76 = (value: string) => value.match(/.{1,76}/g)?.join("\r\n") ?? "";

/** RFC 2047 encoded words, ≤45 bytes of UTF-8 each so no word exceeds 75 characters. */
export function encodeHeaderWord(value: string): string {
  const clean = value.replace(/[\r\n\t]+/g, " ").trim();
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk: number[] = [];
  for (const char of clean) {
    const bytes = encoder.encode(char);
    if (chunk.length + bytes.length > 45) { words.push(`=?UTF-8?B?${base64(Uint8Array.from(chunk))}?=`); chunk = []; }
    chunk.push(...bytes);
  }
  if (chunk.length) words.push(`=?UTF-8?B?${base64(Uint8Array.from(chunk))}?=`);
  return words.join(" ");
}

function formatDate(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

function formatAddress({ name, address }: MailAddress): string {
  if (!name?.trim()) return `<${address}>`;
  const encoded = encodeHeaderWord(name);
  const display = encoded.startsWith("=?") ? encoded : `"${encoded.replace(/["\\]/g, "")}"`;
  return `${display} <${address}>`;
}

export function assertAddress(address: string, step: string): string {
  const value = address.trim();
  if (!ADDRESS.test(value) || value.length > 254) throw new SmtpError(step, null, "invalid address");
  return value;
}

/** Full RFC 5322 message with CRLF line endings; the caller applies dot-stuffing. */
export function buildMessage(message: MailMessage, messageId: string, date: Date): string {
  const boundary = `=_${messageId.replace(/[^A-Za-z0-9]/g, "").slice(0, 40)}`;
  const headers = [
    `Date: ${formatDate(date)}`,
    `From: ${formatAddress(message.from)}`,
    `To: ${message.to.map((address) => `<${address}>`).join(", ")}`,
    `Subject: ${encodeHeaderWord(message.subject)}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) => [
    `--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap76(base64Text(body)),
  ].join("\r\n");
  return [...headers, "", part("text/plain", message.text), part("text/html", message.html), `--${boundary}--`, ""].join("\r\n");
}

export function dotStuff(data: string): string {
  return data.split("\r\n").map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
}

function completeReplyEnd(text: string): number {
  let position = 0;
  for (;;) {
    const index = text.indexOf("\r\n", position);
    if (index < 0) return -1;
    if (/^\d{3}( |$)/.test(text.slice(position, index))) return index + 2;
    position = index + 2;
  }
}

class Session {
  private pending = "";
  private readonly decoder = new TextDecoder();
  private readonly chunk = new Uint8Array(4096);
  constructor(private readonly conn: Transport, private readonly stepTimeoutMs: number, private readonly deadline: number) {}

  private timed<T>(promise: Promise<T>, step: string): Promise<T> {
    const remaining = Math.min(this.stepTimeoutMs, this.deadline - Date.now());
    if (remaining <= 0) throw new SmtpError(step, null, "timeout");
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => { try { this.conn.close(); } catch { /* closed */ } reject(new SmtpError(step, null, "timeout")); }, remaining); }),
    ]).finally(() => clearTimeout(timer));
  }

  async reply(step: string): Promise<{ code: number; text: string }> {
    for (;;) {
      const end = completeReplyEnd(this.pending);
      if (end >= 0) {
        const raw = this.pending.slice(0, end - 2);
        this.pending = this.pending.slice(end);
        const lines = raw.split("\r\n");
        const code = Number(lines[lines.length - 1].slice(0, 3));
        return { code, text: lines.map((line) => line.slice(4)).join(" ") };
      }
      if (this.pending.length > 65536) throw new SmtpError(step, null, "reply too long");
      const n = await this.timed(this.conn.read(this.chunk), step);
      if (n === null) throw new SmtpError(step, null, "connection closed");
      this.pending += this.decoder.decode(this.chunk.subarray(0, n), { stream: true });
    }
  }

  async send(step: string, line: string): Promise<void> {
    const bytes = encoder.encode(`${line}\r\n`);
    let offset = 0;
    while (offset < bytes.length) offset += await this.timed(this.conn.write(bytes.subarray(offset)), step);
  }

  async command(step: string, line: string, expected: number[]): Promise<{ code: number; text: string }> {
    await this.send(step, line);
    const reply = await this.reply(step);
    if (!expected.includes(reply.code)) throw new SmtpError(step, reply.code, reply.text);
    return reply;
  }
}

const defaultConnect: Connect = async (hostname, port) => {
  const conn = await Deno.connectTls({ hostname, port });
  await conn.handshake();
  return conn;
};

export async function sendMail(config: SmtpConfig, message: MailMessage, options: SendOptions = {}): Promise<SendResult> {
  const from = assertAddress(message.from.address, "sender");
  const recipients = [...new Set(message.to.map((address) => assertAddress(address, "recipient")))];
  if (!recipients.length) throw new SmtpError("recipient", null, "no recipients");
  const stepTimeoutMs = options.stepTimeoutMs ?? 20_000;
  const deadline = Date.now() + (options.totalTimeoutMs ?? 60_000);
  const messageId = options.messageId ?? `${crypto.randomUUID()}@${from.slice(from.indexOf("@") + 1)}`;
  const data = dotStuff(buildMessage({ ...message, from: { ...message.from, address: from }, to: recipients }, messageId, (options.now ?? (() => new Date()))()));

  let conn: Transport;
  try {
    conn = await Promise.race([
      (options.connect ?? defaultConnect)(config.host, config.port),
      new Promise<never>((_, reject) => setTimeout(() => reject(new SmtpError("connect", null, "timeout")), stepTimeoutMs)),
    ]);
  } catch (error) {
    if (error instanceof SmtpError) throw error;
    throw new SmtpError("connect", null, error instanceof Error ? error.message : "connect failed");
  }
  const session = new Session(conn, stepTimeoutMs, deadline);
  try {
    const banner = await session.reply("banner");
    if (banner.code !== 220) throw new SmtpError("banner", banner.code, banner.text);
    const ehlo = await session.command("ehlo", `EHLO ${options.clientName ?? "inje-playground.vercel.app"}`, [250]);
    if (!/\bAUTH\b[^\n]*\bLOGIN\b/i.test(ehlo.text)) throw new SmtpError("auth", null, "AUTH LOGIN not offered");
    await session.command("auth", "AUTH LOGIN", [334]);
    await session.command("auth", base64Text(config.user), [334]);
    await session.command("auth", base64Text(config.pass), [235]);
    await session.command("mail-from", `MAIL FROM:<${from}>`, [250]);
    const accepted: string[] = [], rejected: Array<{ address: string; code: number }> = [];
    for (const address of recipients) {
      await session.send("rcpt-to", `RCPT TO:<${address}>`);
      const reply = await session.reply("rcpt-to");
      if (reply.code === 250 || reply.code === 251) accepted.push(address);
      else if (reply.code >= 400 && reply.code < 600) rejected.push({ address, code: reply.code });
      else throw new SmtpError("rcpt-to", reply.code, reply.text);
    }
    if (accepted.length) {
      await session.command("data", "DATA", [354]);
      await session.send("data", `${data}\r\n.`);
      const stored = await session.reply("data");
      if (stored.code !== 250) throw new SmtpError("data", stored.code, stored.text);
    }
    try { await session.command("quit", "QUIT", [221]); } catch { /* message already accepted */ }
    return { accepted, rejected, messageId };
  } finally {
    try { conn.close(); } catch { /* already closed */ }
  }
}
