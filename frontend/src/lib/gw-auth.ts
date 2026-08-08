import { createHmac } from "crypto";

export function buildGwSignature(p: {
  oAuthToken: string;
  signKey: string;
  transactionId: string;
  timestamp: number;
  pathname: string;
}): string {
  const msg = `${p.oAuthToken}${p.transactionId}${p.timestamp}${p.pathname}`;
  return createHmac("sha256", p.signKey).update(msg).digest("base64");
}

export function isInnogridEmail(email: string): boolean {
  return /@innogrid\.com$/i.test(email.trim());
}
