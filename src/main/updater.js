import { EventEmitter } from 'node:events';
import { app, dialog, BrowserWindow } from 'electron';

/**
 * 应用自更新（electron-updater，GitHub Releases 通道）：
 * 打包版启动后延迟检查，之后每 6 小时检查一次；下载完成后询问是否立即重启安装。
 * 开发模式直接跳过。
 */
export class UpdaterService extends EventEmitter {
  constructor() {
    super();
    this.autoUpdater = null;
    this.state = app.isPackaged ? { phase: 'idle' } : { phase: 'dev' };
    this.checkedAt = null;
  }

  async loadUpdater() {
    if (!app.isPackaged) return null;
    if (this.autoUpdater) return this.autoUpdater;
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = true; // 上游 harness 为 rc 发行，跟随其节奏
    autoUpdater.on('checking-for-update', () => this.setState({ phase: 'checking' }));
    autoUpdater.on('update-available', (info) =>
      this.setState({ phase: 'available', version: info?.version })
    );
    autoUpdater.on('update-not-available', () => this.setState({ phase: 'current' }));
    autoUpdater.on('download-progress', (p) =>
      this.setState({ phase: 'downloading', percent: Math.round(p.percent || 0) })
    );
    autoUpdater.on('update-downloaded', (info) => {
      this.setState({ phase: 'downloaded', version: info?.version });
      this.promptInstall(info?.version);
    });
    autoUpdater.on('error', (err) => this.setState({ phase: 'error', message: err?.message }));
    this.autoUpdater = autoUpdater;
    return autoUpdater;
  }

  setState(patch) {
    this.state = { ...this.state, ...patch, checkedAt: new Date().toISOString() };
    this.emit('state', this.state);
  }

  async check(silent = true) {
    let updater;
    try {
      updater = await this.loadUpdater();
    } catch (err) {
      this.setState({ phase: 'error', message: `自更新模块加载失败：${err?.message || err}` });
      return { error: err?.message || String(err) };
    }
    if (!updater) {
      this.setState({ phase: 'dev' });
      return { skipped: true, reason: 'dev' };
    }
    try {
      const result = await updater.checkForUpdates();
      return { result };
    } catch (err) {
      if (!silent) {
        dialog.showMessageBox({
          type: 'info',
          title: '检查更新',
          message: '检查更新失败',
          detail: `${err?.message || String(err)}\n\n请确认网络连接后重试。`,
        });
      }
      return { error: err?.message || String(err) };
    }
  }

  promptInstall(version) {
    const win = BrowserWindow.getAllWindows()[0];
    const buttons = ['立即重启并安装', '稍后'];
    const detail = `新版本 ${version ?? ''} 已下载完成，重启应用即可完成安装。`;
    const opts = {
      type: 'info',
      title: '更新已就绪',
      message: 'DeepSeek Harness Desktop 更新已下载',
      detail,
      buttons,
      defaultId: 0,
      cancelId: 1,
    };
    const clicked = win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
    clicked.then(({ response }) => {
      if (response === 0) this.quitAndInstall();
    });
  }

  quitAndInstall() {
    this.autoUpdater?.quitAndInstall(false, true);
  }
}
