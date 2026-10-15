import { readFileSync, writeFileSync } from 'node:fs';

const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
const propsPath = 'agent/Directory.Build.props';
const props = readFileSync(propsPath, 'utf8');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const requested = process.argv[2];
if (requested === '--check') {
  const native = /<Version>([^<]+)<\/Version>/.exec(props)?.[1];
  if (
    native !== metadata.version ||
    lock.version !== metadata.version ||
    lock.packages[''].version !== metadata.version
  )
    throw new Error('Versions differ. Run npm run version:set -- X.Y.Z.');
  if (
    process.env.GITHUB_REF_TYPE === 'tag' &&
    process.env.GITHUB_REF_NAME !== `v${metadata.version}`
  )
    throw new Error('Release tag must match package.json version.');
  console.log(`Version aligned: ${metadata.version}`);
} else {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(requested ?? ''))
    throw new Error('Usage: npm run version:set -- X.Y.Z (stable SemVer only)');
  const next = requested.split('.').map(Number);
  const previous = metadata.version.split('.').map(Number);
  if (
    !next.some(
      (value, index) =>
        value > previous[index] && next.slice(0, index).every((item, i) => item === previous[i]),
    )
  )
    throw new Error('New version must be greater than current version.');
  metadata.version = requested;
  lock.version = requested;
  lock.packages[''].version = requested;
  writeFileSync('package.json', JSON.stringify(metadata, null, 2) + '\n');
  writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
  writeFileSync(
    propsPath,
    props.replace(/<Version>[^<]+<\/Version>/, `<Version>${requested}</Version>`),
  );
  console.log(
    `Updated to ${requested}. Update CHANGELOG, run checks, commit, then create and push tag v${requested}.`,
  );
}
