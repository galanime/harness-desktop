import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { logsDir, ensureDir } from './paths.js';
import { loadSettings } from './settings.js';

/**
 * 本机 Ollama 管理：定位二进制、确保守护进程在线、查询/拉取模型。
 * 模型拉取进度以事件形式广播给控制中心。
 */
export class OllamaManager extends EventEmitter {
  constructor() {
    super();
    this.host = loadSettings().ollamaHost;
    this.spawnedServe = null; // 仅记录我们启动的 serve 进程
    this.pulling = null; // 进行中的拉取：{ model, controller }
  }

  host() {
    return loadSettings().ollamaHost;
  }

  findBinary() {
    const candidates = [
      process.env.OLLAMA,
      '/opt/homebrew/bin/ollama',
      '/usr/local/bin/ollama',
      '/usr/bin/ollama',
      path.join(process.env.HOME || '', '.ollama', 'bin', 'ollama'),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* 跳过 */
      }
    }
    // 最后求助于 which
    try {
      return execFileSync('which', ['ollama'], { timeout: 3000 }).toString().trim() || null;
    } catch {
      return null;
    }
  }

  async api(pathname, options = {}, timeoutMs = 10_000) {
    const res = await fetch(`${this.host}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res;
  }

  /** 探测守护进程是否在线。 */
  async isRunning() {
    try {
      const res = await this.api('/api/tags', {}, 3_000);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * 确保 Ollama 在线：已在线则复用；否则若有二进制则拉起 `ollama serve`
   * （记录 pid，应用退出时回收）。返回 { running, startedByApp, binary, error }。
   */
  async ensureDaemon() {
    if (await this.isRunning()) return { running: true, startedByApp: false };
    const binary = this.findBinary();
    if (!binary) {
      return {
        running: false,
        startedByApp: false,
        binary: null,
        error:
          '未找到 Ollama。请通过 Homebrew 安装（brew install ollama && brew services start ollama），' +
          '或从 https://ollama.com/download 下载 Ollama.app。',
      };
    }
    ensureDir(logsDir());
    const out = fs.openSync(path.join(logsDir(), 'ollama.log'), 'a');
    const child = spawn(binary, ['serve'], {
      env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
      stdio: ['ignore', out, out],
      detached: true,
    });
    this.spawnedServe = child;
    // 等待就绪（最多 20s）
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await this.isRunning()) return { running: true, startedByApp: true, binary };
    }
    return {
      running: false,
      startedByApp: false,
      binary,
      error: 'Ollama 启动超时，请查看日志（控制中心 → 打开日志目录）。',
    };
  }

  /** 已安装模型列表（模型名数组）；Ollama 不在线返回 null。 */
  async models() {
    try {
      const res = await this.api('/api/tags', {}, 5_000);
      if (!res.ok) return null;
      const data = await res.json();
      return (data.models || []).map((m) => m.name);
    } catch {
      return null;
    }
  }

  async modelInstalled(name) {
    const list = await this.models();
    if (!list) return false;
    const base = name.split(':')[0];
    return list.some((n) => n === name || n.startsWith(`${base}:`));
  }

  /**
   * 拉取模型（POST /api/pull 流式解析进度）。
   * 事件：'pull-progress' {model, percent, status}、'pull-done' {model}、'pull-error' {model, message}
   */
  async pull(model) {
    if (this.pulling) {
      throw new Error(`已有模型拉取任务进行中（${this.pulling.model}），请稍候。`);
    }
    const daemon = await this.ensureDaemon();
    if (!daemon.running) throw new Error(daemon.error || 'Ollama 未运行。');

    const controller = new AbortController();
    this.pulling = { model, controller };
    try {
      const res = await this.api(
        '/api/pull',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: true }),
          signal: controller.signal,
        },
        60 * 60 * 1000
      );
      if (!res.ok) {
        throw new Error(`Ollama 拒绝拉取（HTTP ${res.status}）：${(await res.text()).slice(0, 300)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastEmit = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.completed && evt.total) {
              const percent = Math.round((evt.completed / evt.total) * 100);
              if (Date.now() - lastEmit > 200 || percent === 100) {
                lastEmit = Date.now();
                this.emit('pull-progress', { model, percent, status: evt.status || '下载中' });
              }
            }
          } catch {
            /* 忽略无法解析的行 */
          }
        }
      }
      this.emit('pull-done', { model });
      return { ok: true, model };
    } catch (err) {
      const message = err?.name === 'AbortError' ? '已取消' : err?.message || String(err);
      this.emit('pull-error', { model, message });
      return { ok: false, model, message };
    } finally {
      this.pulling = null;
    }
  }

  cancelPull() {
    if (this.pulling) this.pulling.controller.abort();
  }

  async dispose() {
    if (this.spawnedServe && this.spawnedServe.pid) {
      try {
        process.kill(-this.spawnedServe.pid, 'SIGTERM');
      } catch {
        /* 已退出 */
      }
      this.spawnedServe = null;
    }
  }
}
