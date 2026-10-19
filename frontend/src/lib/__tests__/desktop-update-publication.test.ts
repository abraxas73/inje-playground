// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto';
import { expect, it } from 'vitest';
import { signUpdate, verifyUpdate } from '../../../../mobile/scripts/desktop-update-signing.mjs';
import { preparePublication, verifyStoredArtifact, publicationSQL } from '../../../scripts/lib/desktop-publication.mjs';

const pair = () => {
  const key = generateKeyPairSync('ed25519');
  return {
    privateKey: key.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64'),
    publicKey: key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
  };
};
const keys = pair(), body = Buffer.from('immutable final installer');
const options = { body, build: 59, minimumOS: '10.0.17763', ...keys };
it('signs final immutable bytes using canonical raw Ed25519 keys', () => {
  const update = signUpdate(options);
  expect(Object.keys(update).sort()).toEqual(['build', 'edSignature', 'minimumOS']);
  expect(verifyUpdate(body, update, keys.publicKey)).toBe(true);
});
it('fails closed without a signing key or when keys do not match', () => {
  expect(() => signUpdate({ ...options, privateKey: '' })).toThrow();
  expect(() => signUpdate({ ...options, publicKey: pair().publicKey })).toThrow();
});
it('rejects changed bytes, signatures and wrong public key', () => {
  const update = signUpdate(options);
  expect(() => verifyUpdate(Buffer.from('changed'), update, keys.publicKey)).toThrow();
  expect(() => verifyUpdate(body, { ...update, edSignature: Buffer.alloc(64).toString('base64') }, keys.publicKey)).toThrow();
  expect(() => verifyUpdate(body, update, pair().publicKey)).toThrow();
});
it('requires platform-specific immutable artifact names and valid metadata', () => {
  const update = signUpdate(options);
  const artifact = preparePublication('windows', '1.7.8', 'INNOGRID-Windows-1.7.8-Setup.exe', body, update, keys.publicKey);
  expect(artifact.path).toBe('windows/1.7.8/INNOGRID-Windows-1.7.8-Setup.exe');
  expect(() => preparePublication('macos', '1.7.8', artifact.filename, body, update, keys.publicKey)).toThrow();
  expect(() => preparePublication('windows', '01.7.8', artifact.filename, body, update, keys.publicKey)).toThrow();
  expect(() => signUpdate({ ...options, build: 0 })).toThrow();
});
it('does not accept an existing version object with different bytes', () => {
  const artifact = preparePublication('windows', '1.7.8', 'INNOGRID-Windows-1.7.8-Setup.exe', body, signUpdate(options), keys.publicKey);
  expect(verifyStoredArtifact(body, artifact)).toBe(true);
  expect(() => verifyStoredArtifact(Buffer.from('other'), artifact)).toThrow();
});
it('publishes only one JSON platform atomically with a hash compare-and-set guard', () => {
  const artifact = preparePublication('windows', '1.7.8', 'INNOGRID-Windows-1.7.8-Setup.exe', body, signUpdate(options), keys.publicKey);
  const sql = publicationSQL('windows', artifact, 'a'.repeat(64));
  expect(sql).toContain("jsonb_set(value::jsonb, '{windows}'");
  expect(sql).toContain("value::jsonb->'windows'->>'sha256' = '" + 'a'.repeat(64));
  expect(sql).not.toContain('macos');
  expect(sql).not.toContain('upsert');
  expect(sql).toContain('RETURNING');
  expect(() => publicationSQL('windows', artifact, "' OR TRUE")).toThrow();
});
