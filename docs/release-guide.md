# 发布流程指南

本文档说明合并上游代码后，各端的发布流程、顺序依赖和具体操作命令。

---

## 一、概览

| 包 | 发布目标 | 发布方式 | 当前版本 |
|----|---------|---------|---------|
| `@slopus/happy-wire` | npm（上游维护） | 本地 workspace，不需要单独发布 | 0.1.0 |
| `happy-server` | Docker Compose | 重新构建镜像并重启 | 私有 |
| `@kmmao/happy-coder` (CLI) | npm | `npm publish` | 0.14.0 |
| `@slopus/agent` | npm | `npm publish`（暂不需要） | 0.1.0 |
| `happy-app` | EAS | OTA 或原生构建 | 1.6.2 |

### 发布顺序

```
happy-wire（本地构建即可）
    ↓
happy-server（Docker 部署）
    ↓
happy-cli（npm 发布）
    ↓
happy-app（EAS 构建/OTA）
```

**为什么按这个顺序**：Server 的通信协议变更后，CLI 和 App 必须匹配新协议才能正常工作。CLI 发布后用户更新即可连新 Server；App 最后发布，因为构建周期最长。

---

## 二、Server 发布（Docker Compose）

### 前提

- 服务器上已有 Docker 和 Docker Compose
- 已拉取最新代码到服务器

### 步骤

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 安装依赖（happy-wire 等新包需要）
yarn install

# 3. 重新构建 Server 镜像
docker compose build server

# 4. 重启服务（保持数据库等不动）
docker compose up -d server

# 5. 查看启动日志，确认正常
docker compose logs -f server
```

### 验证

```bash
# 检查服务是否响应
curl http://localhost:3005/

# 检查所有容器状态
docker compose ps
```

### 如果涉及数据库变更

当 Prisma schema 有改动时，需要先跑迁移：

```bash
# 进入 server 容器执行迁移
docker compose exec server npx prisma migrate deploy
```

> **注意**：Docker Compose 中的 server 启动时会自动执行 `prisma migrate deploy`，通常不需要手动操作。但如果启动日志报迁移错误，需要排查。

---

## 三、CLI 发布（npm publish）

### 前提

- 本地已登录 npm（`npm login`）
- 具有 `@kmmao` scope 的发布权限

### 步骤

```bash
# 1. 确认当前版本
cat packages/happy-cli/package.json | grep '"version"'

# 2. 修改版本号（手动编辑 packages/happy-cli/package.json）
# 例如：0.14.0 → 0.15.0

# 3. 构建
yarn workspace @kmmao/happy-coder build

# 4. 运行测试
yarn workspace @kmmao/happy-coder test

# 5. 发布到 npm
cd packages/happy-cli && npm publish --access public --ignore-scripts

# 6. 回到仓库根目录
cd ../..
```

### 其他机器更新

```bash
# 全局安装/更新
npm update -g @kmmao/happy-coder

# 验证版本
happy --version
```

### 本地开发（不发 npm）

如果只是本地使用最新代码，不需要发布到 npm：

```bash
# 方式 A：直接全局安装本地构建
yarn workspace @kmmao/happy-coder build
npm install -g ./packages/happy-cli

# 方式 B：npm link（改代码后重新 build 即生效）
cd packages/happy-cli
yarn build
npm link
```

---

## 四、App 发布（EAS 预览包）

### OTA vs 原生构建

| 改动类型 | 发布方式 | 说明 |
|---------|---------|------|
| 仅 JS/TS 代码改动 | OTA | 快速推送，用户自动更新 |
| 原生配置变更（app.config.js 的原生部分） | 原生构建 | 需要重新安装 App |
| 新增/删除原生依赖 | 原生构建 | 需要重新安装 App |
| 删除 ios/android 原生目录 | **原生构建** | 架构变更，必须重新构建 |

### OTA 更新（JS-only 改动）

```bash
# 预览包 OTA
yarn workspace happy-app ota

# 生产包 OTA
yarn workspace happy-app ota:production
```

### 原生构建（预览包）

```bash
# iOS + Android 预览包（非交互式，后台构建）
eas build --profile preview --platform ios --no-wait --non-interactive
eas build --profile preview --platform android --no-wait --non-interactive

# 或使用 release 脚本一次性构建所有 profile
cd packages/happy-app && sh release-dev.sh
```

### 查看构建状态

```bash
# 列出最近的构建
eas build:list

# 或在 Expo 控制台查看
# https://expo.dev
```

### 验证

1. 从 EAS 下载预览包安装到手机
2. 打开 App，检查能否正常连接 Server
3. 测试核心功能：创建会话、发送消息、接收回复

---

## 五、合并上游后的完整发布检查清单

当从 `upstream/main` 合并大量更新后，按以下顺序操作：

### 准备阶段

- [ ] 合并上游代码并解决所有冲突
- [ ] 在本地 `yarn install`（安装新依赖，如 `happy-wire`）
- [ ] 确认 TypeScript 编译通过：`yarn workspace happy-server build`
- [ ] 确认 CLI 构建通过：`yarn workspace @kmmao/happy-coder build`
- [ ] 确认 App 类型检查通过：`yarn workspace happy-app typecheck`

### 发布阶段

- [ ] **Server**：在服务器上拉代码 → `yarn install` → `docker compose build server` → `docker compose up -d server` → 确认日志正常
- [ ] **CLI**：改版本号 → `build` → `test` → `npm publish` → 其他机器 `npm update -g`
- [ ] **App**：判断 OTA 还是原生构建 → 执行对应命令 → 安装测试

### 验证阶段

- [ ] CLI 能正常连接新 Server
- [ ] App 能正常连接新 Server
- [ ] 创建新会话、发送消息、接收回复均正常
- [ ] 你新增的功能仍然正常（如：键盘收起、needsAttention 状态标记等）

---

## 六、常见问题

### Server 启动失败

```bash
# 查看完整日志
docker compose logs server

# 常见原因：
# 1. 数据库迁移未执行 → 检查 Prisma 迁移
# 2. 环境变量缺失 → 检查 .env 文件
# 3. 端口被占用 → lsof -ti tcp:3005
```

### CLI 发布失败

```bash
# npm 未登录
npm login

# scope 权限不足
npm access ls-packages @kmmao

# 版本号已存在（不能重复发布同一版本）
# → 修改为更高的版本号
```

### App OTA 后白屏/崩溃

如果 OTA 后 App 出现问题，说明本次改动包含原生变更，需要原生构建：

```bash
# 重新构建预览包
eas build --profile preview --platform ios
eas build --profile preview --platform android
```

### yarn install 报错（happy-wire 相关）

合并上游后首次 `yarn install` 可能因为 `happy-wire` 的 postinstall 脚本报错：

```bash
# 先构建 happy-wire
cd packages/happy-wire && yarn build && cd ../..

# 再重新安装
yarn install
```
