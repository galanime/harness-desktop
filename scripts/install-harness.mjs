// 把上游 @deepseek-ai/dsh 的最新发行版安装到 harness-runtime/，
// 供 electron-builder 以 extraResources 方式打包进应用。
// 用法：node scripts/install-harness.mjs [version|latest]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'harness-runtime', 'lib');
const version = process.argv[2] || 'latest';

const npmCandidates = [
  process.env.NPM,
  path.join(process.env.HOME || '', '.local', 'bin', 'npm'),
  '/opt/homebrew/bin/npm',
  '/usr/local/bin/npm',
  '/opt/local/bin/npm',
  '/usr/bin/npm',
].filter(Boolean);
let npm = null;
for (const candidate of npmCandidates) {
  if (fs.existsSync(candidate)) {
    npm = candidate;
    break;
  }
}
if (!npm) {
  try {
    const which = execFileSync('which', ['npm'], { timeout: 3000 }).toString().trim();
    if (which) npm = which;
  } catch {
    /* 无 which */
  }
}
if (!npm) {
  console.error('错误：未找到 npm，请先安装 Node.js ≥ 20。');
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });
const pkgFile = path.join(target, 'package.json');
if (!fs.existsSync(pkgFile)) {
  fs.writeFileSync(pkgFile, JSON.stringify({ name: 'harness-runtime', private: true }, null, 2));
}

const cache = path.join(root, '.npm-cache');
fs.mkdirSync(cache, { recursive: true });

console.log(`安装 @deepseek-ai/dsh@${version} → ${target} …`);
execFileSync(
  npm,
  ['install', '--prefix', target, '--no-audit', '--no-fund', '--no-update-notifier', '--cache', cache, `@deepseek-ai/dsh@${version}`],
  { stdio: 'inherit', cwd: root }
);

const bin = path.join(target, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
if (!fs.existsSync(bin)) {
  console.error('错误：安装后未找到 dsh 入口文件：' + bin);
  process.exit(1);
}
const installed = JSON.parse(
  fs.readFileSync(path.join(target, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')
).version;
console.log(`✔ harness-runtime 就绪：@deepseek-ai/dsh@${installed}`);
