// Audit the exact Git index, not only the working tree. Never print matched secret values.
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
const git = (...args) => execFileSync('git', args, { maxBuffer: 20 * 1024 * 1024 });
const entries = git('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean);
const secretPatterns = [
  /sk-or-v1-[A-Za-z0-9_-]{16,}/,
  /\bsk-[A-Za-z0-9_-]{24,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const localKeys = [];
for (const file of await readdir('conf').catch(() => [])) {
  if (!/keys/i.test(file)) continue;
  const text = await readFile(`conf/${file}`, 'utf8').catch(() => '');
  localKeys.push(...(text.match(/sk-or-v1-[A-Za-z0-9_-]+/g) || []));
}
let failures = 0;
for (const entry of entries) {
  const [metadata, path] = entry.split('\t');
  const [mode, object] = metadata.split(' ');
  const reasons = [];
  if (
    /^(?:conf|third_party|node_modules|output|\.wxt|qa-results|test-results|playwright-report|\.vscode|\.idea)\//.test(
      path,
    )
  )
    reasons.push('private/generated directory');
  if (
    (/(^|\/)\.env/.test(path) && path !== '.env.example') ||
    /\.(?:pem|key|keys|p12|pfx|log)$/.test(path)
  )
    reasons.push('credential or local-only file');
  if (mode === '160000' || mode === '120000') reasons.push('nested repository or symlink');
  if (mode !== '160000') {
    const data = git('cat-file', 'blob', object);
    const text = data.toString();
    if (data.length > 2 * 1024 * 1024) reasons.push('unexpected large file');
    if (path.endsWith('.zip')) {
      if (!/^docs\/downloads\/JevLens-[\d.]+-chrome\.zip$/.test(path)) {
        reasons.push('unexpected archive');
      } else {
        try {
          execFileSync('python3', ['scripts/check-extension-zip.py', '--stdin'], {
            input: data,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          reasons.push('extension archive audit failed; values withheld');
        }
      }
    }
    if (
      secretPatterns.some((pattern) => pattern.test(text)) ||
      localKeys.some((key) => text.includes(key))
    )
      reasons.push('possible credential; value withheld');
    if (path === '.env.example' && /^(?:TYPESAFE_API_KEY|LENS_PROXY_TOKEN)=.+$/m.test(text))
      reasons.push('non-empty secret in template');
  }
  if (reasons.length) {
    failures++;
    console.error(`${path}: ${reasons.join(', ')}`);
  }
}
if (!entries.length) {
  console.error('No files are staged/tracked. Stage the intended public files first.');
  process.exitCode = 1;
} else if (failures) process.exitCode = 1;
else
  console.log(
    `PASS: ${entries.length} indexed files; no known local credentials, key patterns, generated directories, nested repositories or symlinks.`,
  );
