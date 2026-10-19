import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { signUpdate } from './desktop-update-signing.mjs';
const binary = process.argv[2];
if (!binary) throw new Error('Expected pinned Sparkle sign_update binary');
const key = generateKeyPairSync('ed25519');
const privateKey = key.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64');
const publicKey = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const body = Buffer.from('isolated native signature compatibility fixture');
const update = signUpdate({ body, build: 1, minimumOS: '12.0', privateKey, publicKey });
const directory = await mkdtemp(join(tmpdir(), 'innocrew-sparkle-signature-'));
const file = join(directory, 'fixture.bin');
try {
  await writeFile(file, body);
  const run = () => spawnSync(binary, ['--verify', '--ed-key-file', '-', file, update.edSignature], { input: privateKey, encoding: 'utf8' }).status;
  assert.equal(run(), 0, 'official Sparkle accepts our final-byte signature');
  await writeFile(file, Buffer.from('tampered'));
  assert.notEqual(run(), 0, 'official Sparkle rejects changed bytes');
  console.log('PASS: Sparkle 2.10 signature compatibility and tamper rejection');
} finally { await rm(directory, { recursive: true }); }
