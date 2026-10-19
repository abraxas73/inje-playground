// Upload/verify only. Apply emitted compare-and-set SQL through Supabase MCP.
// node --env-file=.env.local scripts/publish-desktop.mjs PLATFORM VERSION FILE EXPECTED_PLATFORM_SHA256
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { preparePublication, verifyStoredArtifact, publicationSQL } from './lib/desktop-publication.mjs';

async function main() {
  const [platform, version, file, expectedHash] = process.argv.slice(2);
  if (!file) throw new Error('Missing artifact');
  const body = await readFile(file);
  const update = JSON.parse(await readFile(`${file}.update.json`, 'utf8'));
  const keys = JSON.parse(await readFile(new URL('../../mobile/desktop-update-public-keys.json', import.meta.url), 'utf8'));
  const artifact = preparePublication(platform, version, basename(file), body, update, keys[platform]);
  const sql = publicationSQL(platform, artifact, expectedHash);
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const bucket = 'desktop-releases';
  const { data: existing, error: bucketError } = await client.storage.getBucket(bucket);
  if (bucketError || !existing || existing.public) throw new Error('Private release bucket unavailable');
  const { error: uploadError } = await client.storage.from(bucket).upload(artifact.path, body, { contentType: 'application/octet-stream', upsert: false });
  const duplicate = uploadError && (String(uploadError.statusCode) === '409' ||
    (String(uploadError.statusCode) === '400' && /already exists/i.test(uploadError.message)));
  if (uploadError && !duplicate) throw new Error('Release upload failed');
  const { data: downloaded, error: downloadError } = await client.storage.from(bucket).download(artifact.path);
  if (downloadError || !downloaded) throw new Error('Release verification download failed');
  verifyStoredArtifact(Buffer.from(await downloaded.arrayBuffer()), artifact);
  // No SDK database access: MCP applies one platform atomically. Zero returned
  // rows means stale snapshot/rollback; stop rather than overwrite another job.
  console.log(JSON.stringify({ platform, artifact, storageVerified: true, published: false, publicationSQL: sql }, null, 2));
}
main().catch(() => { console.error('Release preparation failed; no metadata was published. Check immutable artifact, signature, private bucket and expected platform hash.'); process.exitCode = 1; });
