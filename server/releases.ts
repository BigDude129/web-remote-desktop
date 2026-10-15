import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AgentRelease } from '../shared/releases.js';

const versionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
export const manifestSchema = z.object({
  version: versionSchema,
  protocolVersion: z.number().int().positive(),
  platform: z.literal('win-x64'),
  assetName: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive(),
});

async function boundedJson(response: Response) {
  if (!response.ok || !response.body) throw new Error('Release request failed');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) throw new Error('Release metadata too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export class ReleaseService {
  private cached?: AgentRelease;
  private nextCheck = 0;
  private inFlight?: Promise<AgentRelease>;
  private localCache?: { identity: string; release: AgentRelease };

  constructor(
    private repository: string,
    private artifacts = resolve('artifacts'),
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {
    if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
      throw new Error('Invalid RELEASE_REPOSITORY');
  }

  latest(): Promise<AgentRelease> {
    if (!this.repository)
      return Promise.resolve({
        available: false,
        checkedAt: this.now(),
        stale: false,
        error: 'disabled',
      });
    if (this.cached && this.now() < this.nextCheck) return Promise.resolve(this.cached);
    if (!this.inFlight)
      this.inFlight = this.fetchLatest().finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  private async fetchLatest(): Promise<AgentRelease> {
    const checkedAt = this.now();
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DeskLink-release-check',
      'X-GitHub-Api-Version': '2026-03-10',
    };
    const signal = AbortSignal.timeout(8000);
    try {
      const response = await this.fetcher(
        `https://api.github.com/repos/${this.repository}/releases/latest`,
        { headers, signal },
      );
      if (response.status === 404) {
        this.nextCheck = checkedAt + 60_000;
        return (this.cached = {
          available: false,
          checkedAt,
          stale: false,
          error: 'not_published',
        });
      }
      const data = await boundedJson(response);
      if (
        data.draft ||
        data.prerelease ||
        typeof data.tag_name !== 'string' ||
        !data.tag_name.startsWith('v')
      )
        throw new Error('Not a stable release');
      const version = versionSchema.parse(data.tag_name.slice(1));
      const assetName = `DeskLink.Agent-${version}-win-x64.zip`;
      const base = `https://github.com/${this.repository}/releases/download/v${version}/`;
      const assets = z
        .array(z.object({ name: z.string(), browser_download_url: z.string(), size: z.number() }))
        .parse(data.assets);
      const manifestAsset = assets.find((asset) => asset.name === 'agent-release.json');
      const zip = assets.find((asset) => asset.name === assetName);
      if (
        !manifestAsset ||
        manifestAsset.browser_download_url !== `${base}agent-release.json` ||
        !zip ||
        zip.browser_download_url !== `${base}${assetName}`
      )
        throw new Error('Release assets do not match');
      const manifest = manifestSchema.parse(
        await boundedJson(await this.fetcher(manifestAsset.browser_download_url, { signal })),
      );
      if (
        manifest.version !== version ||
        manifest.assetName !== assetName ||
        manifest.size !== zip.size
      )
        throw new Error('Release manifest mismatch');
      this.nextCheck = checkedAt + 5 * 60_000;
      return (this.cached = {
        available: true,
        source: 'github',
        ...manifest,
        downloadUrl: zip.browser_download_url,
        releaseUrl: `https://github.com/${this.repository}/releases/tag/v${version}`,
        publishedAt: data.published_at,
        checkedAt,
        stale: false,
      });
    } catch {
      this.nextCheck = checkedAt + 60_000;
      if (this.cached?.available)
        return (this.cached = { ...this.cached, checkedAt, stale: true, error: 'check_failed' });
      return (this.cached = { available: false, checkedAt, stale: false, error: 'check_failed' });
    }
  }

  async distribution(): Promise<AgentRelease> {
    const remote = await this.latest();
    if (remote.available) return remote;
    try {
      const manifestPath = resolve(this.artifacts, 'agent-release.json');
      const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
      if (manifest.assetName !== `DeskLink.Agent-${manifest.version}-win-x64.zip`)
        throw new Error('Invalid asset name');
      const path = resolve(this.artifacts, manifest.assetName);
      const info = await stat(path);
      const manifestInfo = await stat(manifestPath);
      const identity = `${manifestInfo.mtimeMs}:${info.mtimeMs}:${info.size}`;
      if (this.localCache?.identity === identity)
        return { ...this.localCache.release, checkedAt: remote.checkedAt, error: remote.error };
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (info.size !== manifest.size || hash.digest('hex') !== manifest.sha256)
        throw new Error('Local checksum mismatch');
      const release: AgentRelease = {
        available: true,
        source: 'local',
        ...manifest,
        downloadUrl: '/api/agent/download',
        checkedAt: remote.checkedAt,
        stale: false,
        error: remote.error,
      };
      this.localCache = { identity, release };
      return release;
    } catch (error) {
      return {
        ...remote,
        error:
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? remote.error
            : 'invalid_local_package',
      };
    }
  }

  localPath(release: AgentRelease) {
    if (
      release.source !== 'local' ||
      release.assetName !== `DeskLink.Agent-${release.version}-win-x64.zip`
    )
      throw new Error('Not a local package');
    return resolve(this.artifacts, release.assetName!);
  }
}
