// Explicit administrative step; no secrets in command arguments or output.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { readPrivateKey } from './sign-desktop-update.mjs';
import { signUpdate } from './desktop-update-signing.mjs';
try {
  const privateKey = readPrivateKey('windows');
  const keys = JSON.parse(await readFile(new URL('../desktop-update-public-keys.json', import.meta.url), 'utf8'));
  signUpdate({ body: Buffer.from('CI provisioning check'), build: 1, minimumOS: '10.0.17763', privateKey, publicKey: keys.windows });
  const result = spawnSync('gh', ['secret', 'set', 'INNOCREW_WINDOWS_UPDATE_PRIVATE_KEY', '--repo', 'abraxas73/inje-playground'], { input: privateKey, encoding: 'utf8', maxBuffer: 4096 });
  if (result.status !== 0) throw new Error('CI provisioning failed');
  console.log('Windows update key stored in GitHub Actions encrypted secrets');
} catch { console.error('Could not provision CI update signing key'); process.exitCode = 1; }
