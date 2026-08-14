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

/** 载荷统一放在 lib/ 子目录（electron-builder 会排除根级 node_modules）。 */
export const LIB = 'lib';

/** 打包时随应用分发的 harness 运行时（npm 安装的 @deepseek-ai/dsh，位于 lib/ 下）。 */
export function bundledHarnessDir() {
  return path.join(resourcesDir(), 'harness-runtime');
}

/** 用户数据目录下的 harness 运行时（运行时同步更新写入这里，优先于打包版本）。 */
export function runtimeHarnessDir() {
  return path.join(app.getPath('userData'), 'harness');
}

/** 识图 MCP 服务器目录（打包后位于 Resources/vision-mcp；开发模式为仓库 mcp/qwen-vision-mcp）。 */
export function bundledVisionMcpDir() {
  return isPackaged
    ? path.join(process.resourcesPath, 'vision-mcp')
    : path.join(DEV_ROOT, 'mcp', 'qwen-vision-mcp');
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
