#!/usr/bin/env node
/**
 * qwen-vision-mcp — 本地千问视觉模型 MCP 服务器（stdio）
 *
 * DeepSeek Harness Desktop 的内置识图后端：harness 通过
 * `@deepseek-ai/dsh-mcp-client`（serverName: qwen-vision）挂载本服务器，
 * 得到 mcp__qwen-vision__analyze_image / describe_image / ocr_image /
 * vision_status 等工具；推理全部走本机 Ollama 的 Qwen3-VL 模型，
 * 图片不离开本机。
 *
 * 环境变量（由桌面应用注入，均有默认值）：
 *   QWEN_VL_MODEL     模型名，默认 qwen3-vl:4b
 *   OLLAMA_HOST       Ollama 地址，默认 http://127.0.0.1:11434
 *   QWEN_VL_TIMEOUT_MS 单次推理超时，默认 300000
 *
 * 规范：所有诊断输出一律走 stderr；stdout 仅承载 MCP JSON-RPC 消息。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

// ---------------------------------------------------------------------------
// 常量与配置
// ---------------------------------------------------------------------------

const MODEL = process.env.QWEN_VL_MODEL || 'qwen3-vl:4b';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const CALL_TIMEOUT_MS = Number(process.env.QWEN_VL_TIMEOUT_MS || 300_000);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MiB
const CHARACTER_LIMIT = 12_000; // 单次回复截断上限
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

const log = (...args) => console.error('[qwen-vision-mcp]', ...args);

// ---------------------------------------------------------------------------
// Ollama 客户端
// ---------------------------------------------------------------------------

/**
 * 调用 Ollama /api/chat 做一次视觉推理。失败时抛出带有
 * 「可操作下一步」中文提示的 Error。
 *
 * @param {string} prompt 用户提示词
 * @param {string} imageB64 单张图片的 base64（不带 data: 前缀）
 * @returns {Promise<{ text: string, model: string, elapsedMs: number }>}
 */
async function ollamaChat(prompt, imageB64) {
  const body = JSON.stringify({
    model: MODEL,
    stream: false,
    options: { temperature: 0.1 },
    messages: [
      {
        role: 'user',
        content: prompt,
        images: [imageB64],
      },
    ],
  });

  let res;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    const cause = err?.cause?.code || err?.code || '';
    if (cause === 'ECONNREFUSED' || cause === 'UND_ERR_CONNECT_TIMEOUT' || cause === 'ETIMEDOUT') {
      throw new Error(
        `无法连接本地 Ollama 服务（${OLLAMA_HOST}）。请先启动 Ollama：` +
        `在 DeepSeek Harness Desktop 的「模型管理」面板点击启动，或手动运行 \`brew services start ollama\` / \`ollama serve\`。`
      );
    }
    throw new Error(`调用 Ollama 失败：${err?.message || String(err)}（${OLLAMA_HOST}）`);
  }

  const text = await res.text();
  if (!res.ok) {
    if (/model .* not found/i.test(text)) {
      throw new Error(
        `模型 ${MODEL} 尚未下载。请在 DeepSeek Harness Desktop 的「模型管理」面板点击下载，` +
        `或手动运行 \`ollama pull ${MODEL}\` 后重试。`
      );
    }
    throw new Error(`Ollama 返回错误（HTTP ${res.status}）：${text.slice(0, 500)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Ollama 返回了无法解析的响应。');
  }

  const reply = data?.message?.content;
  if (typeof reply !== 'string' || reply.length === 0) {
    throw new Error('模型没有返回文字内容（空回复）。可尝试换个问法，或降低图片分辨率后重试。');
  }
  return {
    text: reply,
    model: data?.model || MODEL,
    elapsedMs: Number(data?.total_duration ?? 0) / 1e6 || 0,
  };
}

// ---------------------------------------------------------------------------
// 图片解析
// ---------------------------------------------------------------------------

/**
 * 把「本地路径 / http(s) URL / data URL」解析成 base64 字符串。
 * @param {string} image
 * @returns {Promise<string>}
 */
async function resolveImageB64(image) {
  if (image.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(image);
    if (!match || !match[2]) {
      throw new Error('data URL 必须是 base64 编码（形如 data:image/png;base64,....）。');
    }
    const b64 = match[3].replace(/\s+/g, '');
    if (b64.length > (MAX_IMAGE_BYTES * 4) / 3) {
      throw new Error('图片超过 20MiB 上限，请压缩后重试。');
    }
    return b64;
  }

  let buf;
  if (/^https?:\/\//i.test(image)) {
    let res;
    try {
      res = await fetch(image, { signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      throw new Error(`下载图片失败：${err?.message || String(err)}`);
    }
    if (!res.ok) {
      throw new Error(`下载图片失败（HTTP ${res.status}），请确认 URL 可公开访问。`);
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_IMAGE_BYTES) {
      throw new Error('图片超过 20MiB 上限，请换一张更小的图片。');
    }
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    const p = path.resolve(image);
    if (!IMAGE_EXT.has(path.extname(p).toLowerCase())) {
      throw new Error(
        `不支持的图片格式：${path.extname(p) || '(无扩展名)'}。支持 png/jpg/jpeg/webp/gif/bmp。`
      );
    }
    try {
      buf = await readFile(p);
    } catch {
      throw new Error(`无法读取图片文件：${p}。请确认路径存在且当前会话有读取权限。`);
    }
  }

  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error('图片超过 20MiB 上限，请压缩后重试。');
  }
  if (buf.length === 0) {
    throw new Error('图片内容为空。');
  }
  return buf.toString('base64');
}

/** 截断超长回复并附说明。 */
function truncate(text) {
  if (text.length <= CHARACTER_LIMIT) return text;
  return `${text.slice(0, CHARACTER_LIMIT)}\n\n[已截断：回复超过 ${CHARACTER_LIMIT} 字符，完整长度 ${text.length} 字符]`;
}

/** 统一的工具执行包装：错误转为 isError 文本结果。 */
async function guarded(fn) {
  const started = Date.now();
  try {
    const out = await fn();
    const meta = `\n\n---\n*模型 ${MODEL} · 耗时 ${Math.round(Date.now() - started)}ms（本机 Ollama，图片未离开设备）*`;
    return { content: [{ type: 'text', text: truncate(out + meta) }] };
  } catch (err) {
    log('tool error:', err?.message || err);
    return {
      content: [{ type: 'text', text: `[识图失败] ${err?.message || String(err)}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// 服务器与工具
// ---------------------------------------------------------------------------

const server = new McpServer({ name: 'qwen-vision-mcp', version: pkg.version });

const imageSchema = z
  .string()
  .min(1, '必须提供图片')
  .max(4096, '图片参数过长')
  .describe('图片：本地绝对/相对路径（如 /Users/me/photo.png 或 ./screenshot.png）、http(s) URL，或 base64 data URL');

server.registerTool(
  'analyze_image',
  {
    title: 'Analyze Image with local Qwen-VL',
    description: `用本机千问视觉模型（${MODEL}）详细分析一张图片：识别主体、动作、场景、背景、文字、界面/图表结构等，也可以回答关于图片的具体问题。适合「这张图里有什么」「这是什么界面」「截图讲了什么」「图中文字什么意思」等识图任务。

参数：
  - image (string, 必填)：本地图片路径、http(s) URL 或 base64 data URL
  - question (string, 可选)：针对图片的具体问题；缺省时输出完整结构化描述
  - detail ('brief' | 'detailed', 默认 'detailed')：brief 只给一句话要点，detailed 输出分节详述

返回：
  中文 Markdown 文本：按「整体概述 / 主体内容 / 细节与文字 / 场景背景」等分节描述；指定 question 时直接回答问题。图片完全在本机处理，不会上传。

示例：
  - 识别截图中的报错信息并解释：analyze_image({image: '/tmp/error.png', question: '这是什么报错，怎么修？'})
  - 快速看图：analyze_image({image: 'https://example.com/a.jpg', detail: 'brief'})`,
    inputSchema: z
      .object({
        image: imageSchema,
        question: z.string().max(2000, '问题最长 2000 字符').optional().describe('针对图片的具体问题（可选）'),
        detail: z
          .enum(['brief', 'detailed'])
          .default('detailed')
          .describe("输出详略：'brief' 一句话要点，'detailed' 分节详述（默认）"),
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ image, question, detail }) =>
    guarded(async () => {
      const b64 = await resolveImageB64(image);
      const brief = detail === 'brief';
      const prompt = brief
        ? `请用一句中文（不超过 40 字）概括这张图片的内容。${
            question ? `回答这个问题：${question}` : ''
          }`
        : `你是识图助手。请用中文详细分析这张图片，按以下结构输出 Markdown：\n` +
          `## 整体概述\n一句话说明图片内容。\n` +
          `## 主体内容\n识别主体对象、人物/动物/物品、动作与相互关系。\n` +
          `## 细节与文字\n图片中出现的全部文字（原样引用）及其含义；若有界面、图表、代码，说明其结构与要点。\n` +
          `## 场景与背景\n拍摄/绘制场景、背景元素、风格与可能的用途。\n` +
          `${question ? `\n## 针对提问\n用户提问：${question}\n请在本节重点回答。` : ''}`;
      const { text } = await ollamaChat(prompt, b64);
      return text.trim();
    })
);

server.registerTool(
  'describe_image',
  {
    title: 'Caption Image with local Qwen-VL',
    description: `用本机千问视觉模型（${MODEL}）为图片生成一句中文描述（caption），适合做图注、文件名建议或快速预览文字。

参数：
  - image (string, 必填)：本地图片路径、http(s) URL 或 base64 data URL

返回：
  一句 20–60 字的中文描述。图片完全在本机处理，不会上传。`,
    inputSchema: z
      .object({
        image: imageSchema,
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ image }) =>
    guarded(async () => {
      const b64 = await resolveImageB64(image);
      const prompt =
        '请为这张图片写一句 20–60 字的中文描述，客观、信息密度高，适合用作图注。只输出这一句话本身，不要任何前缀或引号。';
      const { text } = await ollamaChat(prompt, b64);
      return text.trim();
    })
);

server.registerTool(
  'ocr_image',
  {
    title: 'OCR Image with local Qwen-VL',
    description: `用本机千问视觉模型（${MODEL}）提取图片中的全部文字（OCR）。适合截图、扫描件、照片中的文字转写。

参数：
  - image (string, 必填)：本地图片路径、http(s) URL 或 base64 data URL
  - structure ('auto' | 'lines' | 'markdown', 默认 'auto')：'lines' 每行一条；'markdown' 保留标题/列表/表格结构；'auto' 由模型按内容自动排版（推荐）

返回：
  提取出的文字。识别结果不保证 100% 准确，重要内容建议人工核对。图片完全在本机处理，不会上传。`,
    inputSchema: z
      .object({
        image: imageSchema,
        structure: z
          .enum(['auto', 'lines', 'markdown'])
          .default('auto')
          .describe("排版方式：'auto' 自动（默认）、'lines' 每行一条、'markdown' 保留结构（表格转 Markdown 表格）"),
      })
      .strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ image, structure }) =>
    guarded(async () => {
      const b64 = await resolveImageB64(image);
      const mode =
        structure === 'markdown'
          ? '保留原文排版：标题用 Markdown 标题，列表用 Markdown 列表，表格转成 Markdown 表格。'
          : structure === 'lines'
            ? '每行文字单独输出一行，保持阅读顺序。'
            : '按内容自动排版：段落、列表、表格（转 Markdown 表格）自然呈现。';
      const prompt =
        `你是 OCR 助手。请把图片中出现的全部文字完整、原样提取出来（不翻译、不改写），${mode}\n` +
        `规则：1) 逐字忠实，包括数字、标点、代码；2) 无法辨认处用 [无法辨认] 占位；` +
        `3) 输出提取的文字本身，不要添加“图中文字是”之类的说明。`;
      const { text } = await ollamaChat(prompt, b64);
      return text.trim();
    })
);

server.registerTool(
  'vision_status',
  {
    title: 'Check local Qwen-VL vision status',
    description: `检查本机识图服务状态：Ollama 是否在运行、视觉模型（${MODEL}）是否已下载、以及已安装的其他视觉模型列表。当识图工具报错时，先调用本工具定位原因。

参数：无

返回：
  JSON 文本：{ running, model, modelInstalled, version, visionModels[] }。`,
    inputSchema: z.object({}).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async () =>
    guarded(async () => {
      let tags;
      try {
        const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(10_000) });
        tags = res.ok ? await res.json() : null;
      } catch {
        tags = null;
      }
      const running = tags !== null;
      const models = tags?.models || [];
      const visionModels = models
        .map((m) => m.name)
        .filter((n) => /vl|vision|llava|moondream|minicpm/i.test(n));
      const modelInstalled =
        running && models.some((m) => m.name === MODEL || m.name.startsWith(`${MODEL}:`));
      const hint = running
        ? modelInstalled
          ? '识图服务就绪，可以直接调用识图工具。'
          : `识图服务未就绪：请先运行 ollama pull ${MODEL}（或在应用的「模型管理」面板点击下载）。`
        : 'Ollama 未运行：请启动 Ollama（brew services start ollama 或应用「模型管理」面板中的启动按钮）。';
      return JSON.stringify(
        {
          running,
          ollamaVersion: running ? (tags.version ?? 'unknown') : null,
          model: MODEL,
          modelInstalled,
          visionModels,
          hint,
        },
        null,
        2
      );
    })
);

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`server ready (model=${MODEL}, ollama=${OLLAMA_HOST})`);
}

main().catch((err) => {
  log('fatal:', err?.stack || err);
  process.exit(1);
});
