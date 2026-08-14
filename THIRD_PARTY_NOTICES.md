# 第三方组件声明（THIRD-PARTY NOTICES）

DeepSeek Harness Desktop 打包分发了以下第三方组件。各组件版权归其原作者所有。

## DeepSeek Harness — MIT License

- 项目：https://github.com/deepseek-ai/deepseek-harness
- npm 包：`@deepseek-ai/dsh` 及 `@deepseek-ai/*` 系列包
- Copyright (c) 2026 DeepSeek
- 许可：MIT License（完整文本见随附的 harness-runtime 内各包 LICENSE 文件）

本应用通过 npm 安装并分发上述包的构建产物，未修改其源码；应用运行时通过
`$DSH_HOME/cordis.patch.yml` 注入配置（识图 MCP 服务器），不影响上游代码。

## Qwen3-VL 模型权重 — Apache License 2.0

- 项目：https://github.com/QwenLM/Qwen3-VL
- 模型：qwen3-vl:4b（由 Ollama 分发，https://ollama.com/library/qwen3-vl）
- Copyright (c) Alibaba Cloud（QwenLM 团队）
- 许可：Apache License 2.0

模型权重由用户通过 Ollama 在首次使用时自行下载，应用本身不包含权重文件。

## Ollama — MIT License

- 项目：https://github.com/ollama/ollama
- Copyright (c) Ollama
- 许可：MIT License

## Electron — MIT License

- 项目：https://github.com/electron/electron
- Copyright (c) Electron contributors；Chromium 与 Node.js 部分遵循各自许可
- 许可：MIT License

## electron-builder / electron-updater — MIT License

- 项目：https://github.com/electron-userland/electron-builder
- 许可：MIT License

## Model Context Protocol TypeScript SDK — MIT License

- 项目：https://github.com/modelcontextprotocol/typescript-sdk
- Copyright (c) Anthropic, PBC. and contributors
- 许可：MIT License

## Sharp — Apache License 2.0

- 项目：https://github.com/lovell/sharp
- 许可：Apache License 2.0（仅构建期使用，不随应用分发）

## Zod — MIT License

- 项目：https://github.com/colinhacks/zod
- Copyright (c) Colin McDonnell
- 许可：MIT License

---

MIT License 全文：https://opensource.org/license/mit
Apache License 2.0 全文：https://www.apache.org/licenses/LICENSE-2.0
