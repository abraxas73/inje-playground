import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Both endpoints are local and use a synthetic credential, never a real token.
// Build the probe with swiftc -parse-as-library before invoking this harness.
const binary = process.argv[2];
if (!binary) throw new Error('Expected compiled RedirectCredentialProbe path');
let originalAuthenticated = false;
let redirectedAuthenticated = false;
let destinationHit = false;
let destinationHost = 'localhost';
const destination = http.createServer((req, res) => {
  destinationHit = true;
  redirectedAuthenticated = Boolean(req.headers.authorization);
  res.end('fixture');
});
destination.listen(0, '127.0.0.1'); await once(destination, 'listening');
const origin = http.createServer((req, res) => {
  originalAuthenticated = req.headers.authorization === 'Bearer updater-test-fixture';
  res.writeHead(302, { location: `http://${destinationHost}:${destination.address().port}/artifact` }); res.end();
});
origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
try {
  for (const host of ['localhost', '127.0.0.1']) {
    destinationHost = host; originalAuthenticated = false; redirectedAuthenticated = false; destinationHit = false;
    const process = spawn(binary, [`http://127.0.0.1:${origin.address().port}/feed`], { stdio: 'ignore' });
    const timer = setTimeout(() => process.kill('SIGTERM'), 15_000);
    const [code] = await once(process, 'exit'); clearTimeout(timer);
    assert.equal(code, 0, 'Foundation request completed');
    assert.equal(originalAuthenticated, true, 'origin receives bearer');
    assert.equal(destinationHit, true, 'off-origin destination reached');
    assert.equal(redirectedAuthenticated, false, `off-origin ${host} must not receive bearer`);
  }
  console.log('PASS: default URLSession strips bearer on cross-host and cross-port redirects');
} finally {
  origin.closeAllConnections(); destination.closeAllConnections(); origin.close(); destination.close();
}
