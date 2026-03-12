# Happy Coder (Fork)

> **⚠️ 声明：本项目是 [slopus/happy](https://github.com/slopus/happy) 的 Fork 版本，仅用于个人学习、研究和自部署使用。原始项目的所有权利归原作者所有。**

## 安装 CLI

```bash
npm install -g @kmmao/happy-coder
```

## 从源码运行

```bash
# 安装依赖
yarn install

# 运行 CLI
yarn cli --help
yarn cli codex
```

## 使用

```bash
# 替代 claude
happy

# 替代 codex
happy codex
```

## 项目结构

| 包 | 路径 | 说明 |
|---|------|------|
| happy-cli | `packages/happy-cli` | CLI 客户端，发布为 `@kmmao/happy-coder` |
| happy-server | `packages/happy-server` | Fastify 后端（Prisma / PostgreSQL / Redis） |
| happy-app | `packages/happy-app` | React Native + Expo 移动端/Web 客户端 |
| happy-agent | `packages/happy-agent` | 远程 Agent 控制 CLI |

## 本地开发

详见 [docs/local-development.md](docs/local-development.md)。

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
