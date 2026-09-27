import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { name, version } = JSON.parse(await readFile('package.json', 'utf8'));
const source = `output/${name}-${version}-chrome.zip`;
execFileSync('python3', ['scripts/check-extension-zip.py', source], { stdio: 'inherit' });
const filename = `JevLens-${version}-chrome.zip`;
await mkdir('docs/downloads', { recursive: true });
await copyFile(source, `docs/downloads/${filename}`);
const hash = createHash('sha256')
  .update(await readFile(source))
  .digest('hex');
await writeFile(`docs/downloads/${filename}.sha256`, `${hash}  ${filename}\n`);
console.log(`Ready: docs/downloads/${filename}`);
