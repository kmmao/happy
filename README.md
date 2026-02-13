<div align="center"><img src="/.github/logotype-dark.png" width="400" title="Happy Coder" alt="Happy Coder"/></div>

<h1 align="center">
  Mobile and Web Client for Claude Code & Codex
</h1>

<h4 align="center">
Use Claude Code or Codex from anywhere with end-to-end encryption.
</h4>

<div align="center">
  
[📱 **iOS App**](https://apps.apple.com/us/app/happy-claude-code-client/id6748571505) • [🤖 **Android App**](https://play.google.com/store/apps/details?id=com.ex3ndr.happy) • [🌐 **Web App**](https://app.happy.engineering) • [🎥 **See a Demo**](https://youtu.be/GCS0OG9QMSE) • [📚 **Documentation**](https://happy.engineering/docs/) • [💬 **Discord**](https://discord.gg/fX9WBAhyfD)

</div>

<img width="5178" height="2364" alt="github" src="/.github/header.png" />


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
npm install -g happy-coder
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
Release (Maintainers)
</h3>

```bash
# from repository root
yarn release
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

- **[Happy App](https://github.com/slopus/happy/tree/main/packages/happy-app)** - Web UI + mobile client (Expo)
- **[Happy CLI](https://github.com/slopus/happy/tree/main/packages/happy-cli)** - Command-line interface for Claude Code and Codex
- **[Happy Agent](https://github.com/slopus/happy/tree/main/packages/happy-agent)** - Remote agent control CLI (create, send, monitor sessions)
- **[Happy Server](https://github.com/slopus/happy/tree/main/packages/happy-server)** - Backend server for encrypted sync

## 🏠 Who We Are

We're engineers scattered across Bay Area coffee shops and hacker houses, constantly checking how our AI coding agents are progressing on our pet projects during lunch breaks. Happy Coder was born from the frustration of not being able to peek at our AI coding tools building our side hustles while we're away from our keyboards. We believe the best tools come from scratching your own itch and sharing with the community.

## 📚 Documentation & Contributing

- **[Documentation Website](https://happy.engineering/docs/)** - Learn how to use Happy Coder effectively
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Development setup including iOS, Android, and macOS desktop variant builds
- **[Edit docs at github.com/slopus/slopus.github.io](https://github.com/slopus/slopus.github.io)** - Help improve our documentation and guides

### 通过 Tailscale 访问本地开发环境（HTTPS）

从其他设备访问本地 **App Web 端**或 **Server API** 时，需 **HTTPS**。可用 **Tailscale Serve** 暴露为 HTTPS：

- 查看当前 Serve，避免冲突：`tailscale serve status`

**App（Metro 8081）** — 若 443 已被占用，用 8443 端口根路径代理到 8081（不要用子路径，否则页面空白）：
- 前台：`tailscale serve --https=8443 8081`
- 后台：`tailscale serve --bg --https=8443 8081`
- 关闭：`tailscale serve --https=8443 8081 off`
- 访问：`https://<机器名>.<tailnet>.ts.net:8443/`
- **若 Tailscale 地址能打开但页面空白/无内容**：Expo 默认把 script 和资源写成 localhost:8081，其他设备会加载失败。启动 App 前设置 `EXPO_PACKAGER_PROXY_URL` 为你的 Tailscale HTTPS 地址，例如：
  ```bash
  EXPO_PACKAGER_PROXY_URL=https://home-macmini.tail8d4b5.ts.net:8443 yarn workspace happy-app start
  ```
  再通过该 HTTPS 地址访问即可正常显示。

**Server（3005）** — 例如用 8444 端口暴露本地 Happy Server：
- 后台：`tailscale serve --bg --https=8444 3005`
- 关闭：`tailscale serve --https=8444 3005 off`
- 访问：`https://<机器名>.<tailnet>.ts.net:8444/`；App 内自定义 Server URL 填该地址即可。
- 若要在 Web 里使用「连接 GitHub 账户」，需在 Server 的 `.env` 中配置 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_REDIRECT_URL`、`APP_URL`（OAuth 完成后跳回的前端地址）；修改后 Docker 需执行 `docker compose build --no-cache server && docker compose up -d --force-recreate server`。详见 [packages/happy-server/README.md](packages/happy-server/README.md)。

详见 [docs/local-development.md](docs/local-development.md)。

## License

MIT License - see [LICENSE](LICENSE) for details.
