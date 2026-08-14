import fs from 'node:fs';
import path from 'node:path';
import { dshHomeDir, bundledVisionMcpDir, ensureDir } from './paths.js';
import { resolveNode } from './node-runtime.js';
import { loadSettings } from './settings.js';

/**
 * 生成并维护 $DSH_HOME/cordis.patch.yml：
 * 通过 insert 语法把本地千问识图 MCP 服务器注入 harness 的配置树，
 * 使模型获得 mcp__qwen-vision__* 工具。
 */
export function writeHarnessPatch() {
  const settings = loadSettings();
  const home = ensureDir(dshHomeDir());
  const node = resolveNode();
  const serverPath = path.join(bundledVisionMcpDir(), 'server.js');

  const yaml = [
    '# DeepSeek Harness Desktop 自动生成 —— 请勿手工编辑，应用启动时会覆盖。',
    '# 作用：把本地千问视觉模型 MCP 服务器注入 harness（insert 语法），',
    '# 模型即可使用 mcp__qwen-vision__analyze_image / describe_image / ocr_image / vision_status。',
    '- insert:',
    '    - id: mcp-qwen-vision',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: qwen-vision',
    '        transport: stdio',
    `        command: ${JSON.stringify(node.command)}`,
    `        args: [${JSON.stringify(serverPath)}]`,
    '        env:',
    `          QWEN_VL_MODEL: ${JSON.stringify(settings.visionModel)}`,
    `          OLLAMA_HOST: ${JSON.stringify(settings.ollamaHost)}`,
    ...(node.asNode ? ['          ELECTRON_RUN_AS_NODE: \'1\''] : []),
    '        reconnect:',
    '          enabled: true',
    '',
  ].join('\n');

  const target = path.join(home, 'cordis.patch.yml');
  fs.writeFileSync(target, yaml, 'utf8');
  return target;
}

/** 是否已为当前运行环境写入过补丁（用于避免无谓重写）。 */
export function patchMatchesDisk() {
  try {
    const onDisk = fs.readFileSync(path.join(dshHomeDir(), 'cordis.patch.yml'), 'utf8');
    return onDisk.includes('mcp-qwen-vision');
  } catch {
    return false;
  }
}
