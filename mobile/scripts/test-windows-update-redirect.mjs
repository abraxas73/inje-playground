import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const binary = process.argv[2];
if (!binary) throw new Error('Expected compiled WinSparkle probe');
let originalAuthenticated = false, redirectedAuthenticated = false, destinationHit = false;
let destinationHost = 'localhost';
const destination = http.createServer((req, res) => {
  destinationHit = true; redirectedAuthenticated = Boolean(req.headers.authorization);
  res.writeHead(200, { 'content-type': 'application/rss+xml' });
  res.end('<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title></channel></rss>');
});
destination.listen(0, '127.0.0.1'); await once(destination, 'listening');
const origin = http.createServer((req, res) => {
  originalAuthenticated = req.headers.authorization === 'Bearer updater-test-fixture';
  res.writeHead(302, { location: `http://${destinationHost}:${destination.address().port}/feed` }); res.end();
});
origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
try {
  for (const host of ['localhost', '127.0.0.1']) {
    destinationHost = host; originalAuthenticated = false; redirectedAuthenticated = false; destinationHit = false;
    const child = spawn(binary, [`http://127.0.0.1:${origin.address().port}/feed`], { stdio: 'inherit' });
    const timer = setTimeout(() => child.kill(), 25000);
    const [code] = await once(child, 'exit'); clearTimeout(timer);
    assert.equal(code, 0, 'WinSparkle probe completed');
    assert.equal(originalAuthenticated, true, 'origin received synthetic bearer');
    assert.equal(destinationHit, true, 'redirect destination was exercised');
    assert.equal(redirectedAuthenticated, false, `WinSparkle must not forward bearer to ${host} on another port`);
  }
  console.log('PASS: pinned WinSparkle strips bearer on cross-origin redirects');
} finally { origin.closeAllConnections(); destination.closeAllConnections(); origin.close(); destination.close(); }
