import { createHash } from 'node:crypto';
import { verifyUpdate } from '../../../mobile/scripts/desktop-update-signing.mjs';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const hash = body => createHash('sha256').update(body).digest('hex');
export function preparePublication(platform, version, filename, body, update, publicKey) {
  if (!['macos', 'windows'].includes(platform) || !versionPattern.test(version) || version.split('.').some(v => +v > 65535)) throw new Error('Invalid release platform/version');
  const expected = platform === 'macos' ? `INNOGRID-macOS-${version}.dmg` : `INNOGRID-Windows-${version}-Setup.exe`;
  if (filename !== expected || !body.length || body.length > 512 * 1024 * 1024) throw new Error('Invalid release artifact');
  verifyUpdate(body, update, publicKey);
  if (update.minimumOS !== (platform === 'macos' ? '12.0' : '10.0.17763')) throw new Error('Unexpected minimum OS');
  return { version, filename, path: `${platform}/${version}/${filename}`, sha256: hash(body), bytes: body.length, releasedAt: new Date().toISOString(),
    update: { build: update.build, edSignature: update.edSignature, minimumOS: update.minimumOS } };
}
export function verifyStoredArtifact(body, artifact) {
  if (body.length !== artifact.bytes || hash(body) !== artifact.sha256) throw new Error('Stored version differs from immutable signed artifact');
  return true;
}
export function publicationSQL(platform, artifact, expectedHash) {
  if (!['macos', 'windows'].includes(platform) || !versionPattern.test(artifact.version) || !Number.isSafeInteger(artifact.update?.build) || artifact.update.build <= 0 || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !(expectedHash === 'none' || /^[a-f0-9]{64}$/.test(expectedHash))) throw new Error('Invalid publication compare-and-set');
  const literal = JSON.stringify(artifact).replaceAll("'", "''");
  const previous = expectedHash === 'none' ? `value::jsonb->'${platform}' IS NULL` : `value::jsonb->'${platform}'->>'sha256' = '${expectedHash}'`;
  // PostgreSQL rechecks the predicate against the locked row. jsonb_set applies
  // to that row, preserving any concurrent publication of the OTHER platform.
  return `UPDATE public.settings
SET value = jsonb_set(value::jsonb, '{${platform}}', '${literal}'::jsonb, true)::text
WHERE key = 'desktop_app_release'
  AND (${previous})
  AND (value::jsonb->'${platform}' IS NULL OR
    (string_to_array(value::jsonb->'${platform}'->>'version', '.')::int[] < string_to_array('${artifact.version}', '.')::int[]
      AND COALESCE((value::jsonb->'${platform}'->'update'->>'build')::bigint, 0) < ${artifact.update.build}))
RETURNING value::jsonb->'${platform}' AS published;`;
}
