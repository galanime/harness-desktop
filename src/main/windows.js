import { BrowserWindow, shell, app, Tray, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brandDir } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function trayIconPath() {
  const base = path.join(brandDir(), 'trayTemplate.png');
  return fs.existsSync(base) ? base : null;
}

export class WindowManager {
  constructor({ harness }) {
    this.harness = harness;
    this.mainWindow = null;
    this.controlWindow = null;
    this.tray = null;
  }

  createMainWindow() {
    const icon = trayIconPath();
    this.mainWindow = new BrowserWindow({
      title: 'DeepSeek Harness Desktop',
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 600,
      backgroundColor: '#0f1117',
      show: false,
      icon,
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        // 主窗口加载的是本机 harness web UI，不注入任何特权 preload。
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // 先显示品牌启动页，harness 就绪后跳转
    this.mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));

    this.mainWindow.once('ready-to-show', () => this.mainWindow.show());

    // 只允许本机 harness 页面；外链交给系统浏览器
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    this.mainWindow.webContents.on('will-navigate', (event, url) => {
      const ok = url.startsWith('http://127.0.0.1:') || url.startsWith('file://');
      if (!ok) {
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      }
    });
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
    return this.mainWindow;
  }

  async showMain() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) this.createMainWindow();
    const url = this.harness.url || (await this.harness.start());
    if (url) {
      this.mainWindow.loadURL(url);
      this.mainWindow.show();
    }
    return this.mainWindow;
  }

  createControlWindow() {
    if (this.controlWindow && !this.controlWindow.isDestroyed()) {
      this.controlWindow.show();
      this.controlWindow.focus();
      return this.controlWindow;
    }
    this.controlWindow = new BrowserWindow({
      title: '控制中心 — DeepSeek Harness Desktop',
      width: 700,
      height: 820,
      minWidth: 640,
      minHeight: 720,
      backgroundColor: '#0f1117',
      show: false,
      icon: trayIconPath(),
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.controlWindow.loadFile(path.join(__dirname, '..', 'renderer', 'control', 'index.html'));
    this.controlWindow.once('ready-to-show', () => this.controlWindow.show());
    this.controlWindow.on('closed', () => {
      this.controlWindow = null;
    });
    return this.controlWindow;
  }

  showControl() {
    return this.createControlWindow();
  }

  all() {
    return [this.mainWindow, this.controlWindow].filter((w) => w && !w.isDestroyed());
  }

  /** 托盘：状态入口 + 常用动作。 */
  createTray() {
    const icon = trayIconPath();
    if (!icon) return null;
    const tray = new Tray(icon);
    tray.setToolTip('DeepSeek Harness Desktop');
    const menu = Menu.buildFromTemplate([
      { label: '打开 DeepSeek Harness', click: () => this.showMain() },
      { label: '控制中心', click: () => this.showControl() },
      { type: 'separator' },
      { label: '同步 Harness 源码', click: () => this.showControl() },
      { type: 'separator' },
      { label: '退出', role: 'quit' },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => this.showMain());
    this.tray = tray;
    return tray;
  }
}
