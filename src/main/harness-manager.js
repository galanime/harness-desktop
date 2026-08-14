import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { bundledHarnessDir, runtimeHarnessDir, dshHomeDir, logsDir, ensureDir } from './paths.js';
import { resolveNode, nodeSpawnEnv } from './node-runtime.js';
import { loadSettings } from './settings.js';

/**
 * dsh 子进程管理器：定位 harness 运行时（用户目录优先，打包版本兜底），
 * 启动 `dsh --profile web`，轮询就绪，管理重启与崩溃恢复。
 */
export class HarnessManager extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.port = null;
    this.url = null;
    this.status = 'stopped'; // starting | running | stopping | stopped | error
    this.restarts = 0;
    this.exitHandler = null;
  }

  /** 解析实际使用的 harness 安装目录（用户目录优先）。 */
  resolveInstallDir() {
    for (const dir of [runtimeHarnessDir(), bundledHarnessDir()]) {
      const bin = path.join(
        dir,
        'lib',
        'node_modules',
        '@deepseek-ai',
        'dsh',
        'lib',
        'bin.js'
      );
      if (fs.existsSync(bin)) return { dir: path.join(dir, 'lib'), bin };
    }
    return null;
  }

  /** 当前生效的 @deepseek-ai/dsh 版本。 */
  installedVersion() {
    const resolved = this.resolveInstallDir();
    if (!resolved) return null;
    try {
      const pkg = JSON.parse(
        fs.readFileSync(
          path.join(resolved.dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
          'utf8'
        )
      );
      return pkg.version || null;
    } catch {
      return null;
    }
  }

  async findFreePort(preferred = 3080) {
    const tryPort = (port) =>
      new Promise((resolve) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', () => resolve(false));
        srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
      });
    if (await tryPort(preferred)) return preferred;
    for (let i = 0; i < 40; i++) {
      const candidate = 20000 + Math.floor(Math.random() * 20000);
      if (await tryPort(candidate)) return candidate;
    }
    throw new Error('找不到可用端口，请关闭占用端口的进程后重试。');
  }

  /** 等待 web UI 就绪（HTTP 200）。 */
  waitReady(port, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
          res.resume();
          if (res.statusCode === 200) {
            clearInterval(timer);
            resolve();
          }
        });
        req.on('error', () => {});
        req.on('timeout', () => req.destroy());
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`web 服务在 ${timeoutMs / 1000}s 内未就绪`));
        }
      }, 300);
    });
  }

  async start() {
    if (this.status === 'running' || this.status === 'starting') return this.url;
    const resolved = this.resolveInstallDir();
    if (!resolved) {
      this.status = 'error';
      this.emit('error', '未找到 DeepSeek Harness 运行时，请先在「控制中心 → 同步与更新」中执行同步。');
      return null;
    }
    const node = resolveNode();
    const settings = loadSettings();
    const port = await this.findFreePort(3080);

    ensureDir(logsDir());
    const logFile = path.join(logsDir(), 'dsh.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    this.status = 'starting';
    this.port = port;
    this.emit('status', this.status, { port });

    const env = nodeSpawnEnv({
      DSH_HOME: dshHomeDir(),
      DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE || 'workspace-write',
      OLLAMA_HOST: settings.ollamaHost,
      QWEN_VL_MODEL: settings.visionModel,
    });
    const child = spawn(
      node.command,
      [resolved.bin, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: resolved.dir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    this.child = child;
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    this.exitHandler = (code, signal) => {
      logStream.end();
      if (this.status === 'stopping' || this.status === 'stopped') return;
      this.child = null;
      this.emit('exited', { code, signal });
      // 崩溃自动恢复：指数退避，最多 3 次
      if (this.restarts < 3) {
        this.restarts += 1;
        const delay = 1000 * 2 ** this.restarts;
        this.status = 'error';
        this.emit('status', 'error', { message: `harness 进程退出（code=${code}），${delay / 1000}s 后自动重启…` });
        setTimeout(() => {
          if (this.status === 'error') this.start().catch(() => {});
        }, delay);
      } else {
        this.status = 'error';
        this.emit('status', 'error', { message: `harness 进程反复退出，已停止自动重启。请查看日志。` });
      }
    };
    child.on('exit', this.exitHandler);

    try {
      await this.waitReady(port);
      this.restarts = 0;
      this.status = 'running';
      this.url = `http://127.0.0.1:${port}`;
      this.emit('status', 'running', { url: this.url, port });
      return this.url;
    } catch (err) {
      this.status = 'error';
      this.emit('status', 'error', { message: err.message });
      this.stop();
      return null;
    }
  }

  async stop() {
    this.status = 'stopping';
    this.emit('status', this.status);
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      const done = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await done;
      clearTimeout(killer);
    }
    this.status = 'stopped';
    this.emit('status', this.status);
  }

  async restart() {
    this.restarts = 0;
    await this.stop();
    return this.start();
  }
}
