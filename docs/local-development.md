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