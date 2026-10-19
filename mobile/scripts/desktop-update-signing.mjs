import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

function rawKey(value) {
  if (typeof value !== 'string') throw new Error('Update key is missing');
  const raw = Buffer.from(value, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== value) throw new Error('Invalid update key');
  return raw;
}
function publicObject(value) {
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey(value)]), format: 'der', type: 'spki' });
}
function validateMetadata(update) {
  if (!update || !Number.isSafeInteger(update.build) || update.build <= 0 || !/^\d+(?:\.\d+){0,3}$/.test(update.minimumOS ?? '')) throw new Error('Invalid update metadata');
}
export function verifyUpdate(body, update, publicKey) {
  validateMetadata(update);
  const signature = Buffer.from(update.edSignature ?? '', 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== update.edSignature || !verify(null, body, publicObject(publicKey), signature)) throw new Error('Update signature verification failed');
  return true;
}
export function signUpdate({ body, build, minimumOS, privateKey, publicKey }) {
  validateMetadata({ build, minimumOS });
  const seed = rawKey(privateKey);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  seed.fill(0);
  const update = { build, edSignature: sign(null, body, key).toString('base64'), minimumOS };
  verifyUpdate(body, update, publicKey); // mismatched release store / embedded public key fails closed
  return update;
}
