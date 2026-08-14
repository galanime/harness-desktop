import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（开发模式）或应用资源目录（打包后）。 */
export const isPackaged = app.isPackaged;
export const DEV_ROOT = path.resolve(__dirname, '..', '..');

export function resourcesDir() {
  return isPackaged ? process.resourcesPath : DEV_ROOT;
}

/** 打包时随应用分发的 harness 运行时（npm 安装的 @deepseek-ai/dsh）。 */
export function bundledHarnessDir() {
  return path.join(resourcesDir(), 'harness-runtime');
}

/** 用户数据目录下的 harness 运行时（运行时同步更新写入这里，优先于打包版本）。 */
export function runtimeHarnessDir() {
  return path.join(app.getPath('userData'), 'harness');
}

/** 打包时随应用分发的识图 MCP 服务器目录。 */
export function bundledVisionMcpDir() {
  return path.join(resourcesDir(), 'vision-mcp');
}

export function brandDir() {
  return path.join(resourcesDir(), 'brand');
}

/** harness 的独立数据目录（DSH_HOME），与用户 CLI 的 ~/.dsh 完全隔离。 */
export function dshHomeDir() {
  return path.join(app.getPath('userData'), 'dsh-home');
}

export function logsDir() {
  return path.join(app.getPath('userData'), 'logs');
}

export function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function npmCacheDir() {
  return path.join(app.getPath('userData'), 'npm-cache');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
