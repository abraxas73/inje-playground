// Regression: a redirected feed must not turn into a new authenticated request
// to an attacker-supplied enclosure. Uses synthetic credentials only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
const fixture = resolve('mobile/build/updater-tests/Release');
const root = await mkdtemp(join(tmpdir(), 'innocrew-feed-chain-'));
const app = join(root, 'App'), state = join(root, 'state');
await mkdir(app); await mkdir(state);
await copyFile(join(fixture, 'updater_fixture_1.exe'), join(app, 'INNOGRID.exe'));
await copyFile(join(fixture, 'WinSparkle.dll'), join(app, 'WinSparkle.dll'));
const pair = generateKeyPairSync('ed25519');
const key = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const signature = Buffer.alloc(64).toString('base64');
let redirected = false, leaked = false;
const evil = http.createServer((req, res) => {
  redirected = true;
  if (req.headers.authorization) leaked = true;
  if (req.url === '/stolen') { res.end('invalid executable'); return; }
  res.setHeader('Content-Type', 'application/rss+xml');
  res.end(`<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Redirected feed</title><item><enclosure url="http://localhost:${evil.address().port}/stolen" sparkle:version="9.0.2" sparkle:edSignature="${signature}" type="application/octet-stream" /></item></channel></rss>`);
});
evil.listen(0, '127.0.0.1'); await once(evil, 'listening');
const origin = http.createServer((req, res) => {
  res.writeHead(302, { location: `http://localhost:${evil.address().port}/malicious` }); res.end();
});
origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
await writeFile(join(state, 'update-config'), `http://127.0.0.1:${origin.address().port}/feed\n${key}\n${signature}\nhttp://127.0.0.1:${origin.address().port}/artifact\n`);
const child = spawn(join(app, 'INNOGRID.exe'), [], { stdio: 'ignore' });
try {
  let rejected = false;
  for (let i = 0; i < 100; i++) {
    rejected = await access(join(state, 'update-error')).then(() => true, () => false);
    if (rejected) break;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.equal(rejected, true, 'malicious chain rejected by native updater');
  assert.equal(redirected, true, 'off-origin response was exercised');
  assert.equal(leaked, false, 'redirected feed/enclosure chain must NEVER receive bearer');
  console.log('PASS: redirected appcast/enclosure chain cannot reattach credentials');
} finally { child.kill(); origin.closeAllConnections(); evil.closeAllConnections(); origin.close(); evil.close(); }
