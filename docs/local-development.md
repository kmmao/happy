# 本地开发：启动与调试

说明如何在本地启动并调试 Happy Coder 各组件（Server、CLI、App），以及如何使用 Docker Compose 搭建后端环境。

---


## 从哪里开始（推荐顺序）


### 前置条件（先装好再往下做）

- **路径 A（Docker 起后端）**：本机必须先安装 **Docker** 和 **Docker Compose**（或安装 Docker Desktop，已自带 Compose）。否则无法执行 `docker compose up -d`。
- **路径 B（Yarn 起后端）**：本机必须先安装 **Node 20**、**Yarn**；若用 Docker 起 PostgreSQL/Redis/MinIO，同样需要先安装 **Docker**（及 Docker Compose）。Server 还需 **FFmpeg**、**Python3**（见下文「一、整体依赖」）。

### 依赖服务一律用 Docker

本仓库推荐 **PostgreSQL、Redis、MinIO 全部用 Docker 运行**，无需本机安装。

- **路径 A**：直接执行 `docker compose up -d` 即可，已包含所有依赖 + Happy Server，一步到位。
- **路径 B**：只起依赖、本机跑 Server 时，执行 `docker compose up -d postgres redis minio minio-init`（不启动 server 服务）；在 `packages/happy-server` 下配好 `.env.dev`，使 `DATABASE_URL`、`REDIS_URL`、S3 等指向 localhost（见下文路径 B 步骤 2），再在本机执行 `yarn workspace happy-server migrate` 与 `yarn workspace happy-server dev`。


本地开发有两条路，**任选其一**即可。做完「第一步」再往下做，不要跳步。

### 路径 A：用 Docker 起后端（适合只想先跑通）

| 步骤 | 做什么 | 详见 |
|------|--------|------|
| **1** | 在仓库根目录执行 `yarn install`，装好依赖 | 下文「一、整体依赖」 |
| **2** | 根目录执行 `docker compose up -d`，等 Server 就绪 | 下文「Docker Compose 启动流程」 |
| **3** | 用 CLI 或 App 连本地：设 `HAPPY_SERVER_URL=http://localhost:3005` 或 App 内填该地址 | 下文「三、Happy CLI」「四、Happy App」 |

做完 1→2→3，就可以用手机/网页连本机 Server。若要改 Server 代码并调试，再走路径 B。

### 路径 B：用 Yarn 本地起后端（适合改 Server/调试）

| 步骤 | 做什么 | 详见 |
|------|--------|------|
| **1** | 在仓库根目录执行 `yarn install`，装好依赖 | 下文「一、整体依赖」 |
| **2** | 执行 `docker compose up -d postgres redis minio minio-init` 只起依赖；在 `packages/happy-server` 下配好 `.env.dev`（DATABASE_URL、REDIS_URL、S3 指向 localhost:5432/6379/9000，与 compose 一致，见「二、Happy Server」） | 下文「二、Happy Server」之 1、2 |
| **3** | 执行迁移后启动 Server：`yarn workspace happy-server migrate`再 `yarn workspace happy-server dev` | 下文「二、Happy Server」之 3 |
| **4** | 起 CLI 或 App，并指向本地 Server（`HAPPY_SERVER_URL` 或 App 内自定义 Server URL） | 下文「三、Happy CLI」「四、Happy App」 |

做完 1→2→3→4，整条链路在本机打通，可联调。

**总结**：无论选哪条路，**第一步都是 `yarn install`**；然后要么用 Docker 起 Server（路径 A），要么自己起 DB + 起 Server（路径 B）；最后用 CLI/App 连 `http://localhost:3005`。下文各节是每一步的详细说明。


---

## 一、整体依赖（Yarn 方式）

- **环境**：Node 20、Yarn、Docker（本地跑 PostgreSQL、Redis、可选 MinIO）
- **Server 额外**：FFmpeg、Python3
- **Monorepo**：在仓库根目录执行 `yarn install`，装齐四个包

---

## 二、Happy Server（后端）

### 1. 环境变量

- `yarn dev` 会加载：`.env` 和 `.env.dev`（先 `.env` 再 `.env.dev`，后者可覆盖）。
- 需要至少：`DATABASE_URL`、`REDIS_URL`、S3 相关（`S3_HOST`、`S3_ACCESS_KEY`、`S3_SECRET_KEY`、`S3_BUCKET`、`S3_PUBLIC_URL` 等）、可选 `PORT`（默认 **3005**）。

### 2. 本地数据库与中间件

**路径 B（只起依赖、本机跑 Server）**：先执行 `docker compose up -d postgres redis minio minio-init`，再在 `packages/happy-server` 的 `.env.dev` 中配置：`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/handy`、，`REDIS_URL=redis://localhost:6379`、`S3_HOST=localhost`、`S3_PORT=9000`、`S3_USE_SSL=false`、`S3_ACCESS_KEY=minioadmin`、`S3_SECRET_KEY=minioadmin`、`S3_BUCKET=handy`、`S3_PUBLIC_URL=http://localhost:9000/handy`（与 [docker-compose.yml](../docker-compose.yml) 一致）。

```bash
yarn workspace happy-server db       # PostgreSQL 容器，端口 5432
yarn workspace happy-server redis     # Redis 容器，端口 6379
yarn workspace happy-server s3        # MinIO 容器，端口 9000/9001（可选）
yarn workspace happy-server s3:init   # 若用 MinIO，初始化 bucket（需先有 .env.dev 里 S3_*）
```

然后：

```bash
yarn workspace happy-server generate
yarn workspace happy-server migrate  # 使用 .env.dev
```

### 3. 启动

```bash
yarn workspace happy-server dev
```

- 会先杀 3005 端口再启动。服务默认在 **http://localhost:3005**。

### 4. VS Code 调试

- 配置在 `packages/happy-server/.vscode/launch.json`，选 **「Debug Server」**。
- **注意**：launch 里 `envFile` 指向 `.env.example`，仓库里只有 `.env.dev`。要么复制 `.env.dev` 为 `.env.example` 并改敏感值为占位符，要么改 launch 的 envFile 为 `.env` / `.env.dev`。

---

## 三、Happy CLI（连本地 Server）

### 1. 开发数据目录

- 开发用：`HAPPY_HOME_DIR=~/.happy-dev`。
- 可运行：`yarn workspace @kmmao/happy-coder run setup:dev`；或使用 direnv + `.envrc.example`（复制为 `.envrc` 后 `direnv allow`）。

### 2. 指向本地 Server

- 环境变量：`HAPPY_SERVER_URL=http://localhost:3005`
- 或：`yarn workspace @kmmao/happy-coder dev:local-server`（会读 `.env.dev-local-server`，需在其中配置 `HAPPY_SERVER_URL=http://localhost:3005`）。

### 3. 启动

```bash
yarn workspace @kmmao/happy-coder dev                    # 直接跑源码
HAPPY_SERVER_URL=http://localhost:3005 yarn workspace @kmmao/happy-coder dev  # 连本地
yarn workspace @kmmao/happy-coder dev:local-server        # 连本地（用 .env.dev-local-server）
```

### 4. 本地安装为全局命令（在任意项目目录使用）

若希望在**其他项目目录**（如 `~/gas`）下直接运行 `happy`，而不是在 happy 仓库根目录执行 `yarn workspace @kmmao/happy-coder dev:local-server`，可将本仓库的 CLI 安装为全局命令：

**方式 A：从本地路径安装（装的是当前仓库 build 结果）**

```bash
cd /path/to/happy   # 进入本仓库根目录
yarn workspace @kmmao/happy-coder build
npm install -g ./packages/happy-cli
```

之后在任意目录执行 `happy claude` 即可，会话的工作目录为**当前目录**。环境变量可在 `.zshrc` 等中配置（如 `HAPPY_SERVER_URL`、`ANTHROPIC_MODEL`）。

**方式 B：npm link（改本地代码后重新 build 即生效）**

```bash
cd /path/to/happy/packages/happy-cli
yarn build
npm link
```

全局 `happy` 会链到本地包，修改代码后在该目录执行 `yarn build` 即可用新逻辑。

**方式 C：从 npm 安装 fork 发布版（在其他机器上快速部署）**

```bash
npm install -g @kmmao/happy-coder
```

安装后在任意目录执行 `happy` 即可。

发布新版本流程：

```bash
# 1. 修改 packages/happy-cli/package.json 中的 version
# 2. 构建
yarn workspace @kmmao/happy-coder build
# 3. 发布（需要 npm 登录 + 2FA）
cd packages/happy-cli && npm publish --access public --ignore-scripts
# 4. 其他机器更新
npm update -g @kmmao/happy-coder
```

**说明**：`npm install -g happy-coder` 安装的是**原作者的发布版**；`npm install -g @kmmao/happy-coder` 安装的是**本 fork 的发布版**。要使用本仓库未发布的最新代码，需用上述方式 A 或 B。

### 5. 守护进程

- 先 build 再起 daemon：`yarn workspace @kmmao/happy-coder build`，然后 `yarn workspace @kmmao/happy-coder dev:daemon:start`。
- 日志：`~/.happy-dev/logs/`（或 `$HAPPY_HOME_DIR/logs/`）。

---

## 四、Happy App（移动/Web 客户端）

### 1. 开发命令

```bash
yarn workspace happy-app start    # Expo 开发服务器
yarn workspace happy-app ios     # iOS 模拟器
yarn workspace happy-app android # Android 模拟器
yarn workspace happy-app web     # 浏览器
```

### 2. 连本地 Server

- **方式一**：App 内设置 → 自定义 Server URL → `http://localhost:3005` 或本机 IP（如 `http://192.168.x.x:3005`）。
- **方式二**：启动前设置 `EXPO_PUBLIC_HAPPY_SERVER_URL=http://localhost:3005`（或本机 IP），再 `yarn workspace happy-app start`。

---

## 五、推荐本地联调顺序

1. 起基础设施：PostgreSQL、Redis（需要时 MinIO + `s3:init`）。
2. 起 Server：`yarn workspace happy-server dev`，确认 3005 正常、迁移已跑。
3. 起 CLI：`HAPPY_SERVER_URL=http://localhost:3005 yarn workspace @kmmao/happy-coder dev` 或 `dev:local-server`；要 daemon 时先 build 再 `dev:daemon:start`。
4. 起 App：`yarn workspace happy-app start`，在设置里填本地 Server URL 或设 `EXPO_PUBLIC_HAPPY_SERVER_URL`。

这样 **App / CLI ↔ Server ↔ 本地 DB/Redis** 就在本机打通。

---

## 六、常见注意点

1. **Server 调试**：launch 的 `.env.example` 若不存在，需新建或改 envFile，否则调试会缺配置。
2. **CLI 连本地**：用 `dev` 时要设 `HAPPY_SERVER_URL` 或用 `dev:local-server`，否则会连线上 API。
3. **手机/模拟器**：真机或其它设备访问本机需用电脑局域网 IP（如 `http://192.168.x.x:3005`），不能只用 localhost。
4. CLI 连本地必须用 `yarn dev:local-server`，不要只跑 `yarn dev` 又期望连本地 Server。

---

# Docker Compose 启动流程

用仓库根目录的 `docker-compose.yml` 可一次性拉起 **PostgreSQL + Redis + MinIO + Happy Server**，无需本机单独装数据库或跑 `yarn workspace happy-server dev`。

## 前置条件

- 已安装 **Docker** 与 **Docker Compose**（v2 的 `docker compose` 或 v1 的 `docker-compose`）。
- 在 monorepo **根目录**执行（即与 `docker-compose.yml` 同目录）。

## 可选：配置密钥

- 生产或需固定密钥时：在根目录创建 `.env`（或 `.env.docker`），或当前 shell 中 `export HANDY_MASTER_SECRET=你的强随机密钥`。
- 不设置时，compose 会使用默认占位符 `change-me-docker-dev-only`（**仅限本地/演示**，生产必须改为强随机值）。
- 可参考根目录 `.env.docker.example`。

## 启动步骤

1. **构建并启动所有服务**（首次会构建 Server 镜像，较慢）： `docker compose up -d` 或 `docker-compose up -d`。
2. **查看日志**：`docker compose logs -f server`，看到类似 `Ready` 即表示 Server 已就绪。
3. **验证**：API http://localhost:3005/ ；MinIO 控制台 http://localhost:9001（minioadmin/minioadmin），bucket `handy`。

## 服务与端口

| 服务 | 端口 | 说明 |
|------|------|------|
| Happy Server | 3005 | API + Socket.IO |
| PostgreSQL | 5432 | 数据库 |
| Redis | 6379 | 缓存/消息 |
| MinIO API | 9000 | S3 兼容存储 |
| MinIO 控制台 | 9001 | Web 管理界面 |

## 停止与清理

`docker compose down` 保留数据卷；`docker compose down -v` 并删除数据卷。

## 仅起依赖、本机跑 Server（路径 B）

若只想要依赖服务、在本机用 Yarn 起 Server，请执行 `docker compose up -d postgres redis minio minio-init`，**不要**执行 `docker compose up -d`（否则会连 Happy Server 一起起）。

## 与本地开发的关系

- **Docker Compose**：只起 Server 及其依赖；CLI/App 在宿主机用 `yarn workspace ...` 运行，把 `HAPPY_SERVER_URL` 或 App 内自定义 Server 设为 `http://localhost:3005`。
- **Web 前端**：通常本地开发直接用 `yarn workspace happy-app start` 更省事。

---

# 环境变量参考

本节列出 Happy 全栈各组件可配置的环境变量。按组件分组，标注是否必填及默认值。

## 在哪里配？环境变量 vs App UI

Happy 有两种方式配置运行参数，大多数场景**只需在 App UI 里操作**，无需手动编辑 `.env` 文件：

### App UI 可配置（推荐）

App 内「设置 → Profile（配置文件）」支持：

- **选择或创建 Profile**：内置 6 套预设（Anthropic / DeepSeek / Z.AI / OpenAI / Azure / MiniMax），也可自建
- **设置任意环境变量**：Profile 内可添加 `ANTHROPIC_MODEL`、`ANTHROPIC_BASE_URL` 等任意 key-value
- **模板变量引用**：值支持 `${VAR}` 或 `${VAR:-默认值}` 语法，引用 daemon 启动时的环境变量
- **会话默认值**：默认会话类型（simple/worktree）、权限模式、tmux 配置
- **启动脚本**：会话创建前执行自定义 shell 脚本
- **模型切换**：会话进行中可通过 App 模型选择器实时热切换

**工作原理**：App 把 Profile 里的变量发给 daemon → daemon 展开 `${VAR}` 模板 → 传给 Claude/Codex 进程。

### 必须用环境变量的场景

以下配置**无法通过 App UI 设置**，必须在 daemon 启动时通过环境变量注入：

| 场景 | 说明 |
|------|------|
| **API 密钥（真实值）** | Profile 中只存模板引用如 `${DEEPSEEK_AUTH_TOKEN}`，密钥本体需在 daemon 机器上设置 |
| **Server 端配置** | Server 的数据库、S3、嵌入模型等只能通过 `.env` 文件配置 |
| **CLI 守护进程参数** | `HAPPY_HOME_DIR`、`HAPPY_SERVER_URL` 等在 daemon 启动前就需要确定 |

**典型用法**：daemon 机器上配好密钥，App 里通过 Profile 引用：

```bash
# daemon 机器的 .zshrc 或 .env 里设置密钥
export DEEPSEEK_AUTH_TOKEN=sk-xxx
export Z_AI_AUTH_TOKEN=sk-yyy

# 启动 daemon（密钥已在环境中）
happy daemon start
```

然后在 App UI 创建 Profile，添加环境变量：
```
ANTHROPIC_AUTH_TOKEN = ${DEEPSEEK_AUTH_TOKEN}
ANTHROPIC_BASE_URL  = ${DEEPSEEK_BASE_URL:-https://api.deepseek.com}
ANTHROPIC_MODEL     = ${DEEPSEEK_MODEL:-deepseek-chat}
```

这样密钥不存储在 App 端，只在 daemon 进程内展开。

---

## Server 环境变量（`packages/happy-server`）

Server 启动时依次加载 `.env` 和 `.env.dev`（后者覆盖前者）。

### 核心（必填）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HANDY_MASTER_SECRET` | — | **必填**。认证/加密主密钥，生产环境必须使用强随机值 |

### 数据库与中间件

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | 无（使用 PGlite） | PostgreSQL 连接 URL。不设则使用内嵌 PGlite |
| `PGLITE_DIR` | `./data/pglite` | PGlite 数据目录（仅在不设 DATABASE_URL 时生效） |
| `DATA_DIR` | `./data` | 基础数据目录（文件存储等） |
| `REDIS_URL` | 无（使用内存总线） | Redis 连接 URL。不设则使用内存事件总线 |
| `PORT` | `3005` | 服务监听端口 |
| `PUBLIC_URL` | `http://localhost:3005` | 公网可访问的 Server URL，用于生成文件下载链接 |
| `NODE_ENV` | `development` | 运行环境 |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:8081` | CORS 允许的来源（逗号分隔）。生产环境必须设为实际域名 |

### S3/MinIO 存储

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `S3_HOST` | — | S3/MinIO 主机名。不设则使用本地文件存储 |
| `S3_PORT` | `9000` | S3 端口 |
| `S3_USE_SSL` | `false` | 是否启用 SSL |
| `S3_ACCESS_KEY` | — | S3 访问密钥 |
| `S3_SECRET_KEY` | — | S3 密钥 |
| `S3_BUCKET` | — | S3 桶名 |
| `S3_PUBLIC_URL` | — | 客户端访问对象存储的公开 URL |
| `S3_REGION` | `us-east-1` | S3 区域 |

### GitHub OAuth

| 变量 | 说明 |
|------|------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App 的 Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App 的 Client Secret |
| `GITHUB_REDIRECT_URL` | OAuth 回调 URL，如 `https://your-domain/v1/connect/github/callback` |
| `APP_URL` / `HAPPY_APP_URL` | OAuth 完成后跳转的前端 URL（无尾斜线） |

### 嵌入模型（知识库语义检索）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EMBEDDING_PROVIDER` | 自动检测 | 嵌入提供者：`ollama`（本地免费）或 `openai`（云端付费） |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama 服务地址 |
| `OLLAMA_EMBED_MODEL` | `bge-m3` | Ollama 嵌入模型（1024 维，多语言） |
| `OPENAI_API_KEY` / `EMBEDDING_API_KEY` | — | OpenAI API Key（使用 OpenAI 嵌入时必填） |
| `OPENAI_EMBED_MODEL` | `text-embedding-3-small` | OpenAI 嵌入模型（1024 维） |

### 知识概要生成（LLM）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PROFILE_PROVIDER` | 自动检测 | 概要生成提供者：`anthropic` 或 `ollama` |
| `ANTHROPIC_API_KEY` | — | Anthropic API Key（使用 Anthropic 生成概要时必填） |
| `ANTHROPIC_PROFILE_MODEL` | `claude-haiku-4-5-20251001` | 概要生成模型 |
| `OLLAMA_CHAT_MODEL` | `gpt-oss:20b` | Ollama 对话模型（用于概要生成） |

### 语音服务（TTS/STT）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TTS_BASE_URL` | `http://tts:8000` | TTS 服务地址 |
| `STT_BASE_URL` | `http://stt:8000` | STT HTTP 服务地址 |
| `STT_WS_URL` | `ws://stt:8001/ws` | STT WebSocket 地址（流式语音识别） |

### 监控与调试

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `METRICS_ENABLED` | `true` | 是否启用 Prometheus 指标服务 |
| `METRICS_PORT` | `9090` | 指标服务端口 |
| `MAX_DAILY_SUPERVISOR_RUNS` | `20` | Supervisor 每日最大运行次数 |
| `DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING` | `false` | 启用集中日志（仅调试用，敏感环境勿开） |

---

## CLI 环境变量（`packages/happy-cli`）

CLI 启动时加载 `.env.dev` 或 `.env.dev-local-server`。

### 连接配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HAPPY_SERVER_URL` | `https://s.sangreal.code.xycloud.info:2443` | 连接的 Server 地址 |
| `HAPPY_WEBAPP_URL` | `https://w.sangreal.code.xycloud.info:2443` | Web 应用地址（配对码页面等） |
| `HAPPY_HOME_DIR` | `~/.happy` | 数据目录。开发时建议 `~/.happy-dev` |
| `HAPPY_VARIANT` | `stable` | CLI 变体（stable/dev） |

### 模型配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ANTHROPIC_MODEL` | SDK 默认 | Claude 模型 ID 或虚拟键（见下文「模型配置方案」） |
| `ANTHROPIC_BASE_URL` | Anthropic 官方 | 自定义 API 端点（代理、路由器等） |
| `GEMINI_MODEL` | `gemini-2.5-pro` | Gemini 模型（使用 `happy gemini` 时） |

### 知识库

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HAPPY_KNOWLEDGE_BASE` | `true` | 是否启用知识库功能 |
| `HAPPY_KNOWLEDGE_MODE` | `auto` | 知识注入模式：`auto`（自动判断）/ `full`（全量）/ `minimal`（精简） |
| `HAPPY_KNOWLEDGE_SENSITIVITY` | — | 知识提取灵敏度阈值 |
| `HAPPY_KNOWLEDGE_TRACK_FILE_EDITS` | — | 追踪文件编辑操作 |
| `HAPPY_KNOWLEDGE_TRACK_TOOL_CALLS` | — | 追踪工具调用 |
| `HAPPY_KNOWLEDGE_TRACK_TOKENS` | — | 追踪 token 用量 |

### 守护进程

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HAPPY_DAEMON_HEARTBEAT_INTERVAL` | `60000` | 心跳间隔（毫秒） |
| `HAPPY_DAEMON_HTTP_TIMEOUT` | `10000` | HTTP 超时（毫秒） |
| `HAPPY_DISABLE_CAFFEINATE` | — | 禁用 macOS caffeinate 防休眠 |

### 其他

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HAPPY_PROVISION_TOKEN` | — | 自动配对令牌 |
| `HAPPY_CLAUDE_PATH` | — | 自定义本地 Claude 二进制路径 |
| `DEBUG` | — | 启用调试日志（设为 `1`） |

---

## App 环境变量（`packages/happy-app`）

所有客户端变量必须使用 `EXPO_PUBLIC_` 前缀。

| 变量 | 说明 |
|------|------|
| `EXPO_PUBLIC_HAPPY_SERVER_URL` | Server 地址 |
| `EXPO_PUBLIC_HAPPY_WEBAPP_URL` | Web 应用地址 |
| `EXPO_PUBLIC_POSTHOG_API_KEY` | PostHog 分析 API Key |
| `EXPO_PUBLIC_REVENUE_CAT_APPLE` | RevenueCat Apple 密钥 |
| `EXPO_PUBLIC_REVENUE_CAT_GOOGLE` | RevenueCat Google 密钥 |
| `EXPO_PUBLIC_REVENUE_CAT_STRIPE` | RevenueCat Stripe 密钥 |

---

# 模型配置方案

Happy 支持多种 AI 模型。配置方式有两种：**App UI**（推荐）和**环境变量**。会话进行中可通过 App 模型选择器实时热切换，无需重启。

## 配置方式总览

| 方式 | 适用场景 | 操作位置 |
|------|----------|----------|
| **App UI Profile** | 日常使用、切换模型、第三方模型 | App → 设置 → Profile |
| **环境变量** | daemon 启动参数、密钥注入、开发调试 | `.zshrc` / `.env` 文件 |
| **会话内切换** | 临时换模型（如 Sonnet→Opus） | App 会话界面的模型选择器 |

## Claude 模型（Anthropic）

### 虚拟键与实际模型

App 模型选择器和环境变量都支持「虚拟键」，由 SDK 解析为实际模型 ID：

| 虚拟键 | 实际模型 | 适用场景 |
|--------|----------|----------|
| `sonnet` | SDK 默认 Sonnet（当前 `claude-sonnet-4-6`） | 日常开发主力，性价比最高 |
| `sonnet-1m` | `claude-sonnet-4-6[1m]` | 大型代码库、长上下文分析 |
| `opus` | SDK 默认 Opus（当前 `claude-opus-4-6`） | 复杂架构决策、深度推理 |
| `opus-1m` | `claude-opus-4-6[1m]` | 大型代码库 + 深度推理 |
| `haiku` | SDK 默认 Haiku（当前 `claude-haiku-4-5`） | 轻量任务、高频调用、省成本 |
| `opusplan` | Plan 阶段用 Opus，执行用 Sonnet | 重要功能的规划+实现 |

也可以直接指定完整模型 ID：

```bash
ANTHROPIC_MODEL=claude-sonnet-4-6 happy claude
ANTHROPIC_MODEL=claude-opus-4-6 happy claude
```

### 推荐配置方案

**方案 A：省钱日常（推荐大多数场景）**

App 内默认 Profile（Anthropic）即可，模型选 Sonnet。需要深度推理时在会话内临时切 Opus。

环境变量方式：`ANTHROPIC_MODEL=sonnet`

**方案 B：最强智力**

App 内模型选 Opus。适合复杂架构设计、疑难 bug、重要功能开发。

环境变量方式：`ANTHROPIC_MODEL=opus`

**方案 C：高频轻量**

App 内模型选 Haiku。适合简单查询、代码解释、快速修改。成本约为 Sonnet 的 1/3。

环境变量方式：`ANTHROPIC_MODEL=haiku`

**方案 D：规划+执行分离**

App 内模型选 `opusplan`：Plan 阶段用 Opus 深度思考，执行阶段用 Sonnet 高效编码。兼顾质量和成本。

### 使用代理/路由器

若使用 API 代理（如 claude-code-router、OpenRouter 等），可在 **App Profile** 或环境变量中配置自定义端点：

**App UI 方式**：Profile → 添加环境变量 → `ANTHROPIC_BASE_URL` = `http://127.0.0.1:3456`

**环境变量方式**：

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:3456
ANTHROPIC_MODEL=claude-sonnet-4-6
```

Docker 容器内访问宿主机代理时需使用 `host.docker.internal`：

```bash
ANTHROPIC_BASE_URL=http://host.docker.internal:8317
```

## 第三方模型（通过 App Profile 配置）

Happy 内置 6 套 Profile 预设，支持主流第三方模型。所有第三方模型都通过 Anthropic SDK 兼容接口接入——设置 `ANTHROPIC_BASE_URL` 指向第三方 API，`ANTHROPIC_AUTH_TOKEN` 设为对应密钥。

### DeepSeek

**步骤 1**：daemon 机器上设置密钥

```bash
# .zshrc 或 .bashrc
export DEEPSEEK_AUTH_TOKEN=sk-xxx
```

**步骤 2**：App 内选择内置 Profile「DeepSeek (Reasoner)」，或创建自定义 Profile，添加：

| 变量 | 值 |
|------|-----|
| `ANTHROPIC_AUTH_TOKEN` | `${DEEPSEEK_AUTH_TOKEN}` |
| `ANTHROPIC_BASE_URL` | `${DEEPSEEK_BASE_URL:-https://api.deepseek.com}` |
| `ANTHROPIC_MODEL` | `${DEEPSEEK_MODEL:-deepseek-chat}` |

### Z.AI (智谱 GLM)

**步骤 1**：daemon 机器上设置密钥

```bash
export Z_AI_AUTH_TOKEN=sk-yyy
```

**步骤 2**：App 内选择内置 Profile「Z.AI (GLM-4.6)」，或创建自定义 Profile，添加：

| 变量 | 值 |
|------|-----|
| `ANTHROPIC_AUTH_TOKEN` | `${Z_AI_AUTH_TOKEN}` |
| `ANTHROPIC_BASE_URL` | `${Z_AI_BASE_URL:-https://open.bigmodel.cn/api/paas/v4}` |
| `ANTHROPIC_MODEL` | `${Z_AI_MODEL:-GLM-4.6}` |

### OpenAI

**步骤 1**：daemon 机器上设置密钥

```bash
export OPENAI_API_KEY=sk-zzz
```

**步骤 2**：App 内选择内置 Profile「OpenAI (GPT-5.3)」，或创建自定义 Profile，添加：

| 变量 | 值 |
|------|-----|
| `ANTHROPIC_AUTH_TOKEN` | `${OPENAI_API_KEY}` |
| `ANTHROPIC_BASE_URL` | `${OPENAI_BASE_URL:-https://api.openai.com/v1}` |
| `ANTHROPIC_MODEL` | `${OPENAI_MODEL:-gpt-5.3}` |

### 自定义 Profile（任意兼容 API）

对于其他兼容 Anthropic/OpenAI 接口的服务，创建自定义 Profile：

1. App → 设置 → Profile → 新建
2. 添加环境变量：`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL`
3. 值可以用 `${VAR:-默认值}` 语法引用 daemon 环境变量
4. 如果服务有自定义模型列表，可在 Profile 中配置自定义模型选项

## Gemini 模型（Google）

通过 `happy gemini` 使用 Google Gemini 系列模型。

| 模型 | 特点 |
|------|------|
| `gemini-3-pro-preview` | 最强能力 |
| `gemini-3-flash-preview` | 快速且能力强 |
| `gemini-2.5-pro` | 上代旗舰（默认） |
| `gemini-2.5-flash` | 上代快速 |
| `gemini-2.5-flash-lite` | 最快最省 |

```bash
# 环境变量方式
GEMINI_MODEL=gemini-3-pro-preview happy gemini

# 或通过 CLI 命令持久化
happy gemini model set gemini-3-pro-preview
happy gemini model get
```

## Server 端模型配置

Server 的模型配置影响**知识库**功能（嵌入 + 概要生成），不影响 Claude 会话本身。

### 方案 A：全本地（免费，需 GPU 或较强 CPU）

```bash
# 嵌入：Ollama bge-m3（多语言，中英双优）
EMBEDDING_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=bge-m3

# 概要：Ollama 本地模型
PROFILE_PROVIDER=ollama
OLLAMA_CHAT_MODEL=gpt-oss:20b
```

先安装 Ollama 并拉取模型：

```bash
ollama pull bge-m3
ollama pull gpt-oss:20b    # 或其他你偏好的模型
```

### 方案 B：全云端（省心，按量付费）

```bash
# 嵌入：OpenAI
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-xxx
OPENAI_EMBED_MODEL=text-embedding-3-small

# 概要：Anthropic
PROFILE_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_PROFILE_MODEL=claude-haiku-4-5-20251001
```

### 方案 C：混合（推荐）

```bash
# 嵌入用本地（高频调用，省钱）
EMBEDDING_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434

# 概要用云端（低频，质量更好）
PROFILE_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_PROFILE_MODEL=claude-haiku-4-5-20251001
```

> **提示**：不配置任何嵌入/概要变量时，知识库的语义检索和概要生成功能会静默跳过，不影响核心功能。