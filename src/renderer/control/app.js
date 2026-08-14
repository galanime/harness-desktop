// 控制中心逻辑：状态轮询 + 事件订阅 + 动作绑定。
const $ = (id) => document.getElementById(id);

const refs = {
  appVersion: $('app-version'),
  stHarness: $('st-harness'),
  stUrl: $('st-url'),
  stInstalled: $('st-installed'),
  stUpstream: $('st-upstream'),
  stSha: $('st-sha'),
  stModel: $('st-model'),
  stOllama: $('st-ollama'),
  syncStatus: $('sync-status'),
  updateStatus: $('update-status'),
  modelStatus: $('model-status'),
  pullWrap: $('pull-wrap'),
  pullBar: $('pull-bar'),
  pullStatus: $('pull-status'),
  modelInput: $('model-input'),
  ollamaInput: $('ollama-input'),
};

let lastStatus = null;
let lastPullPercent = -1;

async function refresh() {
  try {
    const s = await window.dsd.getStatus();
    lastStatus = s;
    refs.appVersion.textContent = `v${s.app.version}`;

    const hs = { running: '运行中', starting: '启动中', stopping: '停止中', stopped: '已停止', error: '异常' };
    const hlabel = hs[s.harness.status] || s.harness.status;
    const hClass = s.harness.status === 'running' ? 'ok' : s.harness.status === 'error' ? 'err' : 'warn';
    refs.stHarness.textContent = hlabel;
    refs.stHarness.className = hClass;
    refs.stUrl.textContent = s.harness.url || '—';
    refs.stInstalled.textContent = s.harness.installedVersion || '未安装';
    refs.stUpstream.textContent =
      s.harness.npmLatest + (s.harness.syncAvailable ? '（有新版本）' : '（已最新）');
    refs.stUpstream.className = s.harness.syncAvailable ? 'warn' : 'ok';
    refs.stSha.textContent = s.harness.githubSha
      ? `${s.harness.githubSha} · ${String(s.harness.githubDate || '').slice(0, 10)}`
      : '—';

    refs.stModel.textContent = s.model.installed
      ? `${s.model.name}（已安装）`
      : `${s.model.name}（未安装）`;
    refs.stModel.className = s.model.installed ? 'ok' : 'warn';

    refs.stOllama.textContent = s.model.ollamaRunning ? '运行中' : '未运行';
    refs.stOllama.className = s.model.ollamaRunning ? 'ok' : 'err';
    refs.modelStatus.textContent = s.model.ollamaRunning
      ? s.model.installed
        ? `本机已安装视觉模型：${s.model.name}。识图工具（mcp__qwen-vision__*）可用。`
        : 'Ollama 在线，但识图模型尚未下载 —— 点击「下载/更新模型」。'
      : 'Ollama 未运行 —— 点击「启动 Ollama」。';

    refs.modelInput.value = s.settings.visionModel;
    refs.ollamaInput.value = s.settings.ollamaHost;
    $('set-autosync').checked = !!s.settings.autoSync;
    $('set-autoupdate').checked = !!s.settings.autoUpdate;
  } catch (err) {
    refs.modelStatus.textContent = `读取状态失败：${err?.message || err}`;
  }
}

function onEvent(channel, payload) {
  switch (channel) {
    case 'event:harness-status':
      refresh();
      break;
    case 'event:sync-state':
      refs.syncStatus.textContent =
        payload.state === 'syncing'
          ? '正在同步（npm install 上游最新版）…'
          : payload.state === 'synced'
            ? `同步完成：harness 已升级到 ${payload.version}。`
            : `同步失败：${payload.message || '未知错误'}`;
      refresh();
      break;
    case 'event:update-state':
      const phases = {
        idle: '待命',
        dev: '开发模式：打包后启用应用自更新。',
        checking: '正在检查应用更新…',
        available: `发现新版本 ${payload.version || ''}，正在下载…`,
        current: '应用已是最新版本。',
        downloading: `下载中 ${payload.percent ?? ''}%…`,
        downloaded: `新版本 ${payload.version || ''} 已下载，重启即可安装。`,
        error: `更新检查失败：${payload.message || ''}`,
      };
      refs.updateStatus.textContent = phases[payload.phase] || payload.phase;
      break;
    case 'event:pull-progress':
      refs.pullWrap.classList.remove('hidden');
      if (payload.percent !== lastPullPercent) {
        lastPullPercent = payload.percent;
        refs.pullBar.style.width = `${payload.percent}%`;
        refs.pullStatus.textContent = `下载中 ${payload.percent}% · ${payload.status || ''}`;
      }
      break;
    case 'event:pull-done':
      lastPullPercent = -1;
      refs.pullBar.style.width = '100%';
      refs.pullStatus.textContent = `模型 ${payload.model} 下载完成。`;
      setTimeout(() => refs.pullWrap.classList.add('hidden'), 4000);
      refresh();
      break;
    case 'event:pull-error':
      refs.pullStatus.textContent = `下载失败：${payload.message}`;
      break;
    default:
      break;
  }
}

// 动作绑定
$('btn-main').addEventListener('click', () => window.dsd.showMain());
$('btn-restart').addEventListener('click', async () => {
  refs.stHarness.textContent = '重启中…';
  await window.dsd.restartHarness();
  refresh();
});

$('btn-sync').addEventListener('click', async () => {
  refs.syncStatus.textContent = '开始同步…';
  const result = await window.dsd.runSync('latest');
  refs.syncStatus.textContent = result.ok
    ? `同步完成：harness 已升级到 ${result.installedVersion ?? '最新'}。`
    : `同步失败：${result.error || '未知错误'}`;
  refresh();
});

$('btn-update').addEventListener('click', () => window.dsd.checkUpdate());

$('btn-pull').addEventListener('click', async () => {
  const model = refs.modelInput.value.trim() || 'qwen3-vl:4b';
  refs.pullWrap.classList.remove('hidden');
  refs.pullBar.style.width = '0%';
  refs.pullStatus.textContent = '准备下载…';
  const { started } = await window.dsd.pullModel(model);
  if (!started) refs.pullStatus.textContent = '无法启动下载任务。';
});

$('btn-ollama').addEventListener('click', async () => {
  const result = await window.dsd.ensureOllama();
  refs.modelStatus.textContent = result.running
    ? 'Ollama 已在线。'
    : result.error || 'Ollama 未运行。';
  refresh();
});

$('btn-save-model').addEventListener('click', async () => {
  await window.dsd.setSettings({
    visionModel: refs.modelInput.value.trim() || 'qwen3-vl:4b',
    ollamaHost: refs.ollamaInput.value.trim() || 'http://127.0.0.1:11434',
  });
  await window.dsd.restartHarness();
  refresh();
});

$('set-autosync').addEventListener('change', (e) => window.dsd.setSettings({ autoSync: e.target.checked }));
$('set-autoupdate').addEventListener('change', (e) => window.dsd.setSettings({ autoUpdate: e.target.checked }));

$('btn-logs').addEventListener('click', () => window.dsd.openLogs());
$('btn-home').addEventListener('click', () => window.dsd.openHome());

// 通用外链按钮
document.querySelectorAll('[data-url]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    window.dsd.openExternal(el.dataset.url);
  });
});

window.dsd.onEvent(onEvent);
refresh();
setInterval(refresh, 8000);
