import { ipcMain, shell, app, dialog } from 'electron';
import path from 'node:path';
import { dshHomeDir, runtimeHarnessDir, logsDir } from './paths.js';
import { loadSettings, saveSettings } from './settings.js';
import { resolveNode } from './node-runtime.js';

/**
 * 注册全部 IPC 处理器；参数化注入各服务与窗口工厂。
 */
export function registerIpc({ harness, syncService, updater, ollama, getWindows }) {
  ipcMain.handle('status:get', async () => {
    const upstream = await syncService.upstreamInfo();
    const installed = harness.installedVersion();
    const models = await ollama.models();
    const settings = loadSettings();
    const ollamaRunning = await ollama.isRunning();
    const modelInstalled = models
      ? models.some((n) => n === settings.visionModel || n.startsWith(`${settings.visionModel.split(':')[0]}:`))
      : false;
    return {
      app: {
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
        node: resolveNode().version,
      },
      harness: {
        installedVersion: installed,
        npmLatest: upstream.npmLatest,
        githubSha: upstream.githubSha,
        githubDate: upstream.githubDate,
        syncAvailable: syncService.needsSync(upstream, installed),
        status: harness.status,
        port: harness.port,
        url: harness.url,
        dshHome: dshHomeDir(),
        installDir: harness.resolveInstallDir()?.dir || null,
      },
      model: {
        name: settings.visionModel,
        installed: modelInstalled,
        ollamaRunning,
        models: models || [],
        pulling: ollama.pulling?.model || null,
      },
      update: updater.state,
      settings,
    };
  });

  ipcMain.handle('sync:run', async (_e, channel) => {
    const result = await syncService.syncNow(channel || 'latest');
    if (result.ok) {
      await harness.restart();
    }
    return result;
  });

  ipcMain.handle('update:check', async () => updater.check(false));

  ipcMain.handle('model:pull', async (_e, model) => {
    ollama.pull(model || loadSettings().visionModel).catch(() => {});
    return { started: true };
  });

  ipcMain.handle('model:pull-cancel', () => ollama.cancelPull());

  ipcMain.handle('ollama:ensure', async () => ollama.ensureDaemon());

  ipcMain.handle('harness:restart', async () => {
    await harness.restart();
    return { url: harness.url };
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    saveSettings(patch || {});
    return loadSettings();
  });

  ipcMain.handle('app:open-logs', () => shell.openPath(logsDir()));
  ipcMain.handle('app:open-home', () => shell.openPath(dshHomeDir()));
  ipcMain.handle('app:open-harness-dir', () => shell.openPath(runtimeHarnessDir()));
  ipcMain.handle('app:show-main', () => getWindows().showMain());
  ipcMain.handle('app:show-control', () => getWindows().showControl());

  ipcMain.handle('shell:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('app:about', () => ({
    name: 'DeepSeek Harness Desktop',
    version: app.getVersion(),
    upstreamRepo: 'https://github.com/deepseek-ai/deepseek-harness',
    appRepo: 'https://github.com/galanime/harness-desktop',
    model: loadSettings().visionModel,
  }));

  // 服务事件 → 渲染进程广播
  const broadcast = (channel, payload) => {
    for (const win of getWindows().all()) {
      win.webContents.send(channel, payload);
    }
  };
  harness.on('status', (status, extra) => broadcast('event:harness-status', { status, ...extra }));
  harness.on('error', (message) => broadcast('event:harness-error', { message }));
  harness.on('exited', (info) => broadcast('event:harness-exited', info));
  syncService.on('sync-state', (s) => broadcast('event:sync-state', s));
  updater.on('state', (s) => broadcast('event:update-state', s));
  ollama.on('pull-progress', (p) => broadcast('event:pull-progress', p));
  ollama.on('pull-done', (p) => broadcast('event:pull-done', p));
  ollama.on('pull-error', (p) => broadcast('event:pull-error', p));
}
