<div align="center"><img src="/.github/logotype-dark.png" width="400" title="Happy Coder" alt="Happy Coder"/></div>

<h1 align="center">
  Mobile and Web Client for Claude Code & Codex
</h1>

<h4 align="center">
Use Claude Code or Codex from anywhere with end-to-end encryption.
</h4>

> **⚠️ 声明：本项目是 [slopus/happy](https://github.com/slopus/happy) 的 Fork 版本，仅用于个人学习、研究和自部署使用。原始项目的所有权利归原作者所有。**

<div align="center">

[📱 **原版 iOS App**](https://apps.apple.com/us/app/happy-claude-code-client/id6748571505) • [🤖 **原版 Android App**](https://play.google.com/store/apps/details?id=com.ex3ndr.happy) • [🌐 **原版 Web App**](https://app.happy.engineering) • [📚 **原版文档**](https://happy.engineering/docs/) • [💬 **原版 Discord**](https://discord.gg/fX9WBAhyfD)

</div>

<img width="5178" height="2364" alt="github" src="/.github/header.png" />

## 快速开始

<h3 align="center">
Step 1: Download App
</h3>

<div align="center">
<a href="https://apps.apple.com/us/app/happy-claude-code-client/id6748571505"><img width="135" height="39" alt="appstore" src="https://github.com/user-attachments/assets/45e31a11-cf6b-40a2-a083-6dc8d1f01291" /></a>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<a href="https://play.google.com/store/apps/details?id=com.ex3ndr.happy"><img width="135" height="39" alt="googleplay" src="https://github.com/user-attachments/assets/acbba639-858f-4c74-85c7-92a4096efbf5" /></a>
</div>

<h3 align="center">
Step 2: Install CLI on your computer
</h3>

```bash
npm install -g @kmmao/happy-coder
```

<h3 align="center">
Run From Source (Repo Checkout)
</h3>

```bash
# from repository root
yarn cli --help
yarn cli codex
```

<h3 align="center">
Step 3: Start using `happy` instead of `claude` or `codex`
</h3>

```bash

# Instead of: claude
# Use: happy

happy

# Instead of: codex
# Use: happy codex

happy codex

```

<div align="center"><img src="/.github/mascot.png" width="200" title="Happy Coder" alt="Happy Coder"/></div>

## How does it work?

On your computer, run `happy` instead of `claude` or `happy codex` instead of `codex` to start your AI through our wrapper. When you want to control your coding agent from your phone, it restarts the session in remote mode. To switch back to your computer, just press any key on your keyboard.

## 🔥 Why Happy Coder?

- 📱 **Mobile access to Claude Code and Codex** - Check what your AI is building while away from your desk
- 🔔 **Push notifications** - Get alerted when Claude Code and Codex needs permission or encounters errors
- ⚡ **Switch devices instantly** - Take control from phone or desktop with one keypress
- 🔐 **End-to-end encrypted** - Your code never leaves your devices unencrypted
- 🛠️ **Open source** - Audit the code yourself. No telemetry, no tracking

## 📦 Project Components

- **[Happy App](https://github.com/kmmao/happy/tree/main/packages/happy-app)** - Web UI + mobile client (Expo)
- **[Happy CLI](https://github.com/kmmao/happy/tree/main/packages/happy-cli)** - Command-line interface for Claude Code and Codex
- **[Happy Agent](https://github.com/kmmao/happy/tree/main/packages/happy-agent)** - Remote agent control CLI (create, send, monitor sessions)
- **[Happy Server](https://github.com/kmmao/happy/tree/main/packages/happy-server)** - Backend server for encrypted sync

## 📚 Documentation & Contributing

- **[原版文档网站](https://happy.engineering/docs/)** - Learn how to use Happy Coder effectively
- **[原版文档仓库](https://github.com/slopus/slopus.github.io)** - 原项目的文档源码

本地开发环境配置（Tailscale HTTPS 等）详见 [docs/local-development.md](docs/local-development.md)。

## ⚠️ 免责声明

### Fork 说明

本仓库是 [slopus/happy](https://github.com/slopus/happy) 的 Fork 版本。原始项目由 [Slopus](https://github.com/slopus) 团队开发和维护，所有原始代码的知识产权和著作权归原作者所有。

### 使用须知

- 本 Fork 仅供**个人学习、研究和自部署**使用，不提供任何形式的商业服务
- 本项目**不提供官方技术支持**，如需帮助请访问[原项目](https://github.com/slopus/happy)
- 使用本项目产生的任何风险由使用者自行承担，作者不对任何直接或间接损失负责
- 本 Fork 中的修改可能与上游版本存在差异，不保证与官方版本的兼容性
- App Store / Google Play 中的应用为原作者发布，与本 Fork 无关

### 商标与品牌

- "Happy Coder" 名称和相关品牌资产归原作者所有
- "Claude Code" 和 "Codex" 是 Anthropic 和 OpenAI 的产品，本项目与这些公司没有官方关联
- 本项目不代表、不隶属于上述任何公司或组织

### 许可证

本项目遵循上游项目的开源许可证。详见原项目 [slopus/happy](https://github.com/slopus/happy) 的许可证条款。
