import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ReleaseService } from '../server/releases.js';
import { newerVersion } from '../shared/releases.js';

const repository = 'example/desklink';
const version = '0.2.0';
const assetName = `DeskLink.Agent-${version}-win-x64.zip`;
const base = `https://github.com/${repository}/releases/download/v${version}/`;
const manifest = {
  version,
  protocolVersion: 1,
  platform: 'win-x64',
  assetName,
  sha256: 'a'.repeat(64),
  size: 4,
};
const metadata = {
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  published_at: '2026-10-15T00:00:00Z',
  assets: [
    { name: 'agent-release.json', size: 300, browser_download_url: `${base}agent-release.json` },
    { name: assetName, size: 4, browser_download_url: `${base}${assetName}` },
  ],
};

test('latest release validates assets and coalesces concurrent checks', async () => {
  let calls = 0;
  const fetcher = (async (input: string | URL | Request) => {
    calls++;
    return Response.json(String(input).endsWith('/latest') ? metadata : manifest);
  }) as typeof fetch;
  const service = new ReleaseService(repository, undefined, fetcher);
  const [first, second] = await Promise.all([service.latest(), service.latest()]);
  assert.equal(first.available, true);
  assert.equal(first.source, 'github');
  assert.equal(first.version, version);
  assert.equal(first.downloadUrl, `${base}${assetName}`);
  assert.deepEqual(first, second);
  await service.latest();
  assert.equal(calls, 2);
});

test('release check rejects draft, mismatched manifest, foreign download host and invalid hash', async () => {
  for (const [release, file] of [
    [{ ...metadata, draft: true }, manifest],
    [metadata, { ...manifest, version: '0.3.0' }],
    [
      {
        ...metadata,
        assets: metadata.assets.map((asset) => ({
          ...asset,
          browser_download_url: 'https://untrusted.example/file',
        })),
      },
      manifest,
    ],
    [metadata, { ...manifest, sha256: 'bad' }],
  ]) {
    const service = new ReleaseService(repository, undefined, (async (input) =>
      Response.json(String(input).endsWith('/latest') ? release : file)) as typeof fetch);
    const result = await service.latest();
    assert.equal(result.available, false);
    assert.equal(result.error, 'check_failed');
  }
});

test('missing release is explicit; network failure marks cached release stale', async () => {
  const missing = new ReleaseService(
    repository,
    undefined,
    (async () => new Response('', { status: 404 })) as typeof fetch,
  );
  assert.equal((await missing.latest()).error, 'not_published');
  let time = 0;
  let failing = false;
  const service = new ReleaseService(
    repository,
    undefined,
    (async (input) => {
      if (failing) throw new Error('Network down');
      return Response.json(String(input).endsWith('/latest') ? metadata : manifest);
    }) as typeof fetch,
    () => time,
  );
  await service.latest();
  failing = true;
  time = 301_000;
  const cached = await service.latest();
  assert.equal(cached.available, true);
  assert.equal(cached.stale, true);
  assert.equal(cached.error, 'check_failed');
});

test('local fallback verifies hash and refuses corrupted or traversing packages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'desklink-release-'));
  try {
    const bytes = Buffer.from('test');
    const local = { ...manifest, sha256: createHash('sha256').update(bytes).digest('hex') };
    await writeFile(join(directory, assetName), bytes);
    await writeFile(join(directory, 'agent-release.json'), JSON.stringify(local));
    const service = new ReleaseService('', directory);
    assert.equal((await service.distribution()).source, 'local');
    await writeFile(join(directory, assetName), 'damaged');
    assert.equal((await service.distribution()).error, 'invalid_local_package');
    await writeFile(
      join(directory, 'agent-release.json'),
      JSON.stringify({ ...local, assetName: '../outside.zip' }),
    );
    assert.equal((await service.distribution()).available, false);
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'desklink-release-')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('semantic version comparisons avoid lexicographic and downgrade mistakes', () => {
  assert.equal(newerVersion('0.10.0', '0.9.9'), true);
  assert.equal(newerVersion('0.1.0', '0.1.0'), false);
  assert.equal(newerVersion('0.2.9', '0.3.0'), false);
  assert.equal(newerVersion('0.3.0-beta.1', '0.2.0'), false);
});
