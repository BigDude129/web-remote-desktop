import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const notices = [
  'DeskLink third-party notices',
  '',
  'Project license: MIT; see LICENSE.',
  'Generated from installed npm packages and package-lock.json. Includes runtime and build dependencies.',
  'Platform-specific optional packages not installed on this build host are not included.',
  'Original licenses and copyright notices remain applicable to their respective components.',
  '',
];
for (const location of Object.keys(lock.packages).sort()) {
  if (!location || !existsSync(join(location, 'package.json'))) continue;
  const metadata = JSON.parse(readFileSync(join(location, 'package.json'), 'utf8'));
  const files = readdirSync(location).filter((name) =>
    /^(licen[cs]e|copying|notice)(\..*)?$/i.test(name),
  );
  const source =
    typeof metadata.repository === 'string'
      ? metadata.repository
      : (metadata.repository?.url ?? metadata.homepage ?? '');
  notices.push(
    '='.repeat(72),
    `${metadata.name}@${metadata.version}`,
    `License: ${metadata.license ?? 'See original license'}`,
    `Source: ${source}`,
    '',
  );
  for (const file of files)
    notices.push(`--- ${file} ---`, readFileSync(join(location, file), 'utf8').trim(), '');
  if (!files.length)
    notices.push(
      'This installed package does not include a top-level license text. Consult its source repository.',
      '',
    );
}
writeFileSync('THIRD-PARTY-NOTICES.txt', notices.join('\n') + '\n');
console.log('Generated THIRD-PARTY-NOTICES.txt from installed dependency licenses.');
