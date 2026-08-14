import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { runtimeHarnessDir, npmCacheDir, ensureDir } from './paths.js';
import { findNpm } from './node-runtime.js';

/**
 * 上游同步：探测 deepseek-ai/deepseek-harness 的最新状态
 * （npm 发行版 dist-tags + GitHub master 最新提交），并可用系统 npm
 * 把新版本安装进用户数据目录，随后由主进程重启 harness。
 */
export class SyncService extends EventEmitter {
  constructor(harnessManager) {
    super();
    this.harness = harnessManager;
    this.syncing = false;
  }

  async fetchJson(url, timeoutMs = 15_000) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'deepseek-harness-desktop' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** 上游最新版本信息；网络失败返回 null 字段。 */
  async upstreamInfo() {
    const info = { npmLatest: null, npmModified: null, githubSha: null, githubDate: null };
    try {
      const data = await this.fetchJson('https://registry.npmjs.org/@deepseek-ai%2Fdsh');
      info.npmLatest = data?.['dist-tags']?.latest || null;
      info.npmModified = data?.time?.modified || null;
    } catch {
      /* npm 通道不可用 */
    }
    try {
      const commits = await this.fetchJson(
        'https://api.github.com/repos/deepseek-ai/deepseek-harness/commits?per_page=1'
      );
      const head = Array.isArray(commits) ? commits[0] : null;
      info.githubSha = head?.sha?.slice(0, 8) || null;
      info.githubDate = head?.commit?.committer?.date || null;
    } catch {
      /* GitHub 通道不可用 */
    }
    return info;
  }

  /** 需要同步：上游 npm 版本比当前安装版本新。 */
  needsSync(upstream, installed) {
    if (!upstream.npmLatest || !installed) return false;
    return upstream.npmLatest !== installed;
  }

  /**
   * 把上游最新版安装到用户数据目录。
   * 返回 { ok, installedVersion, error? }。
   */
  async syncNow(channel = 'latest') {
    if (this.syncing) throw new Error('同步正在进行中，请稍候。');
    const npm = findNpm();
    if (!npm) {
      throw new Error(
        '未找到 npm（需要系统安装 Node.js ≥ 20）。请安装 Node.js 后重试；' +
          '也可以在 GitHub Releases 更新应用本身来获得新版本 harness。'
      );
    }
    this.syncing = true;
    this.emit('sync-state', { state: 'syncing' });
    const target = ensureDir(runtimeHarnessDir());
    const pkgFile = path.join(target, 'package.json');
    if (!fs.existsSync(pkgFile)) {
      fs.writeFileSync(
        pkgFile,
        JSON.stringify({ name: 'harness-runtime', private: true }, null, 2),
        'utf8'
      );
    }
    try {
      const args = [
        'install',
        '--prefix', target,
        '--no-audit',
        '--no-fund',
        '--no-update-notifier',
        '--cache', ensureDir(npmCacheDir()),
        `@deepseek-ai/dsh@${channel}`,
      ];
      const code = await new Promise((resolve) => {
        const child = spawn(npm, args, { stdio: 'inherit', env: process.env });
        child.on('exit', resolve);
      });
      if (code !== 0) throw new Error(`npm install 失败（exit ${code}），请查看日志。`);
      const version = this.harness.installedVersion();
      this.emit('sync-state', { state: 'synced', version });
      return { ok: true, installedVersion: version };
    } catch (err) {
      this.emit('sync-state', { state: 'error', message: err?.message || String(err) });
      return { ok: false, error: err?.message || String(err) };
    } finally {
      this.syncing = false;
    }
  }
}
