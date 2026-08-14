# Changelog

本文件记录 DeepSeek Harness Desktop 的版本变化。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
上游 harness 版本随应用发行版本内置，运行时亦可通过控制中心独立同步。

## [0.1.0] - 2026-08-14

### Added
- Electron 桌面壳：内置启动 `dsh --profile web`，自动端口分配、崩溃自动恢复、独立 `$DSH_HOME`
- 上游同步：npm 发行频道 + GitHub master 双通道探测；一键/自动安装最新 harness 并热重启
- 应用自更新：electron-updater + GitHub Releases 通道
- 千问识图 MCP 服务器 `qwen-vision-mcp`：`analyze_image` / `describe_image` / `ocr_image` / `vision_status`（qwen3-vl:4b 本机推理）
- 控制中心：运行状态、同步与更新、模型管理（拉取进度）、设置、关于与许可
- 品牌资产：Logo（驭架 H + 同步弧）、icns/PNG/托盘图标、DMG 背景、启动页
- 许可证：MIT + THIRD_PARTY_NOTICES + 关于面板
- CI：上游版本检测 → 自动打包发布 macOS arm64（dmg/zip）
