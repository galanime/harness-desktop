import { Menu, app, shell } from 'electron';

const REPO = 'https://github.com/galanime/harness-desktop';
const UPSTREAM = 'https://github.com/deepseek-ai/deepseek-harness';

/**
 * macOS 应用菜单。
 */
export function buildMenu({ windows, updater, syncService, harness }) {
  const template = [
    {
      label: app.name,
      submenu: [
        {
          label: '关于 DeepSeek Harness Desktop',
          click: () => windows.showControl(),
        },
        { type: 'separator' },
        {
          label: '检查应用更新…',
          click: () => updater.check(false),
        },
        {
          label: '同步 Harness 源码…',
          click: async () => {
            windows.showControl();
          },
        },
        { type: 'separator' },
        { label: '服务', role: 'services' },
        { type: 'separator' },
        { label: `隐藏 ${app.name}`, role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: `退出 ${app.name}`, role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '显示',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '帮助',
      role: 'help',
      submenu: [
        {
          label: '控制中心',
          click: () => windows.showControl(),
        },
        { type: 'separator' },
        { label: 'DeepSeek Harness Desktop 项目主页', click: () => shell.openExternal(REPO) },
        { label: '上游：DeepSeek Harness 仓库', click: () => shell.openExternal(UPSTREAM) },
        { label: '报告问题', click: () => shell.openExternal(`${REPO}/issues`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
