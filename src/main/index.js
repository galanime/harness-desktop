import { app, BrowserWindow, dialog } from 'electron';
import { HarnessManager } from './harness-manager.js';
import { SyncService } from './sync.js';
import { UpdaterService } from './updater.js';
import { OllamaManager } from './ollama.js';
import { WindowManager } from './windows.js';
import { buildMenu } from './menu.js';
import { registerIpc } from './ipc.js';
import { writeHarnessPatch } from './harness-home.js';
import { ensureDir, logsDir } from './paths.js';
import { loadSettings } from './settings.js';

const SINGLE_INSTANCE_KEY = 'deepseek-harness-desktop';

// 单实例：重复启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windows?.showMain();
  });

  let harness, syncService, updater, ollama, windows;
  let timers = [];

  app.whenReady().then(async () => {
    ensureDir(logsDir());
    const settings = loadSettings();

    harness = new HarnessManager();
    syncService = new SyncService(harness);
    updater = new UpdaterService();
    ollama = new OllamaManager();
    windows = new WindowManager({ harness });

    // 1) 写入 harness 补丁（注入识图 MCP），然后启动 dsh web
    writeHarnessPatch();
    windows.createMainWindow(); // 先显示启动页
    harness
      .start()
      .then((url) => {
        if (url && windows.mainWindow) {
          windows.mainWindow.loadURL(url);
        }
      })
      .catch((err) => {
        dialog.showErrorBox(
          '启动失败',
          `无法启动 DeepSeek Harness：\n${err?.message || err}\n\n请打开「控制中心」查看状态与日志。`
        );
      });

    // 2) 系统集成
    buildMenu({ windows, updater, syncService, harness });
    windows.createTray();
    registerIpc({ harness, syncService, updater, ollama, getWindows: () => windows });
    app.setAboutPanelOptions({
      applicationName: 'DeepSeek Harness Desktop',
      applicationVersion: app.getVersion(),
      version: `Electron ${process.versions.electron}`,
      copyright:
        'Copyright © 2026 galanime and contributors (MIT).\nDeepSeek Harness © DeepSeek (MIT) — https://github.com/deepseek-ai/deepseek-harness',
      website: 'https://github.com/galanime/harness-desktop',
    });

    // 3) 后台任务：Ollama 守护与模型检查（不阻塞启动）
    setTimeout(async () => {
      const daemon = await ollama.ensureDaemon();
      if (!daemon.running) {
        console.warn('[dsd] ollama:', daemon.error);
      }
    }, 3_000);

    // 4) 后台任务：上游同步探测 + 应用自更新
    const runSyncCheck = async () => {
      if (!loadSettings().autoSync) return;
      const upstream = await syncService.upstreamInfo();
      const installed = harness.installedVersion();
      if (syncService.needsSync(upstream, installed)) {
        const { response } = await dialog.showMessageBox({
          type: 'info',
          title: '发现新版本 Harness',
          message: `上游 deepseek-harness 已发布 ${upstream.npmLatest}（当前 ${installed ?? '未知'}）`,
          detail: '是否立即同步到最新版本？同步完成后 harness 会自动重启（不影响当前会话历史）。',
          buttons: ['立即同步', '稍后再说'],
          defaultId: 0,
          cancelId: 1,
        });
        if (response === 0) {
          const result = await syncService.syncNow();
          if (result.ok) await harness.restart();
        }
      }
    };
    const runUpdateCheck = async () => {
      if (!loadSettings().autoUpdate) return;
      await updater.check(true);
    };
    setTimeout(runSyncCheck, 12_000);
    setTimeout(runUpdateCheck, 15_000);
    const syncTimer = setInterval(runSyncCheck, (settings.syncIntervalHours || 6) * 3600_000);
    const updateTimer = setInterval(runUpdateCheck, 6 * 3600_000);
    timers.push(syncTimer, updateTimer);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windows?.createMainWindow();
    }
    windows?.showMain();
  });

  app.on('window-all-closed', () => {
    // macOS 惯例：窗口全部关闭后应用常驻（托盘可再打开）
  });

  let quitting = false;
  app.on('before-quit', async () => {
    if (quitting) return;
    quitting = true;
    for (const t of timers) clearInterval(t);
    await harness?.stop();
    await ollama?.dispose();
  });
}
