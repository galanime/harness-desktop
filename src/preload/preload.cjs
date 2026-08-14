// 控制中心 preload（沙箱内 CommonJS）：只暴露白名单 API。
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = [
  'event:harness-status',
  'event:harness-error',
  'event:harness-exited',
  'event:sync-state',
  'event:update-state',
  'event:pull-progress',
  'event:pull-done',
  'event:pull-error',
];

contextBridge.exposeInMainWorld('dsd', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  runSync: (channel) => ipcRenderer.invoke('sync:run', channel),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  pullModel: (model) => ipcRenderer.invoke('model:pull', model),
  cancelPull: () => ipcRenderer.invoke('model:pull-cancel'),
  ensureOllama: () => ipcRenderer.invoke('ollama:ensure'),
  restartHarness: () => ipcRenderer.invoke('harness:restart'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openLogs: () => ipcRenderer.invoke('app:open-logs'),
  openHome: () => ipcRenderer.invoke('app:open-home'),
  openHarnessDir: () => ipcRenderer.invoke('app:open-harness-dir'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  showMain: () => ipcRenderer.invoke('app:show-main'),
  onEvent: (callback) => {
    const listeners = EVENTS.map((channel) => {
      const handler = (_event, payload) => callback(channel, payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    });
    return () => listeners.forEach((off) => off());
  },
});
