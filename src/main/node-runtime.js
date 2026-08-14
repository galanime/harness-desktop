import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * 解析可用来运行 Node 脚本的运行时：
 * 优先系统 Node（>=20），否则退回 Electron 自带的 Node（ELECTRON_RUN_AS_NODE=1）。
 * 返回 { command, asNode, version, description }
 */
let cached = null;

const CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', 'node'),
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/opt/local/bin/node',
  '/usr/bin/node',
  // 环境变量 NODE 可能指向外壳运行时（如 hermes），放到最后兜底
  process.env.NODE,
].filter(Boolean);

export function resolveNode() {
  if (cached) return cached;
  const candidates = [...CANDIDATES];
  try {
    const which = execFileSync('which', ['node'], { timeout: 3000 }).toString().trim();
    if (which) candidates.push(which);
  } catch {
    /* 无 which 输出 */
  }
  for (const candidate of new Set(candidates)) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const version = execFileSync(candidate, ['--version'], { timeout: 5000 })
        .toString()
        .trim();
      if (!/^v(\d+)/.test(version) || Number(RegExp.$1) < 20) continue;
      // 强度探针：必须是标准 Node（支持 ESM + worker），过滤 Hermes 等外壳运行时
      const probe = execFileSync(
        candidate,
        ['--input-type=module', '-e', "import{spawn}from'node:child_process';console.log('ok')"],
        { timeout: 8000 }
      )
        .toString()
        .trim();
      if (probe !== 'ok') continue;
      cached = {
        command: candidate,
        asNode: false,
        version,
        description: `系统 Node ${version}`,
      };
      return cached;
    } catch {
      /* 跳过不可执行/不兼容候选 */
    }
  }
  cached = {
    command: process.execPath,
    asNode: true,
    version: `v${process.versions.node}（Electron 内置）`,
    description: `Electron 内置 Node v${process.versions.node}`,
  };
  return cached;
}

/**
 * 生成用于 spawn 的环境变量：需要时加 ELECTRON_RUN_AS_NODE=1，
 * 并屏蔽 DSH 遥测，保证应用内 harness 不上报。
 */
export function nodeSpawnEnv(extra = {}) {
  const node = resolveNode();
  return {
    ...process.env,
    ...(node.asNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    DSH_TELEMETRY_MODE: 'DISABLED',
    ...extra,
  };
}

const NPM_CANDIDATES = [
  process.env.NPM,
  path.join(os.homedir(), '.local', 'bin', 'npm'),
  '/opt/homebrew/bin/npm',
  '/usr/local/bin/npm',
  '/opt/local/bin/npm',
  '/usr/bin/npm',
].filter(Boolean);

/** 定位系统 npm（用于把上游 harness 新版本安装到用户数据目录）。 */
export function findNpm() {
  const candidates = [...NPM_CANDIDATES];
  try {
    const which = execFileSync('which', ['npm'], { timeout: 3000 }).toString().trim();
    if (which) candidates.push(which);
  } catch {
    /* 无 which 输出 */
  }
  for (const candidate of new Set(candidates)) {
    if (fs.existsSync(candidate)) {
      try {
        execFileSync(candidate, ['--version'], { timeout: 5000 });
        return candidate;
      } catch {
        /* 跳过 */
      }
    }
  }
  return null;
}

export function homeDir() {
  return os.homedir();
}
