重建并重启本地 Docker Webapp

## 前提检查

### 1. 确认 Docker 环境可用
```bash
docker compose version
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml ps
```

### 1.5 同步 happy-app 的内部依赖版本号（关键前置）

Docker 构建过程中 `yarn install` 会按 `packages/happy-app/package.json` 的版本约束从 npm 拉取依赖。
如果 happy-app 的 `@kmmao/*` 版本号落后于 npm 最新发布（典型场景：`@kmmao/happy-wire`），新代码可能依赖尚未被 app 显式 pin 的 wire schema，
浏览器加载时会出现类型不匹配 / zod 校验失败 / 字段 undefined。

**扫描 happy-app 的所有内部包依赖**：
```bash
grep -E '"@kmmao/' packages/happy-app/package.json
```

**对每个 `@kmmao/*` 依赖，比较 app pin 版本 vs npm latest**：
```bash
for pkg in $(grep -oE '"@kmmao/[a-z-]+"' packages/happy-app/package.json | sort -u | tr -d '"'); do
  app_pin=$(grep "\"$pkg\"" packages/happy-app/package.json | head -1 | sed 's/.*: "//; s/",*//')
  npm_latest=$(npm view "$pkg" version 2>/dev/null || echo "未发布")
  echo "$pkg → app pins $app_pin | npm latest $npm_latest"
done
```

如果发现任何 `@kmmao/*` 落后（例如 `^0.13.0` vs npm `0.16.0`）：

1. 更新 `packages/happy-app/package.json` 的版本约束到最新（保留 `^` 前缀）
2. 运行 `yarn install` 刷新 `yarn.lock`
3. 运行 `yarn workspace happy-app typecheck` 验证 typecheck 通过
4. 提交：`chore(app): bump @kmmao/happy-wire to ^X.Y.Z`
5. 再进入步骤 2 重建镜像

> **历史教训**：app 的 wire 依赖曾长期 pin 在 `^0.13.0`，而 cli / agent 已到 `^0.16.0`。前端拉到旧 schema 会在 settings.parse 阶段静默丢字段。

### 1.6 检查 build args 是否需要从 .env 注入

webapp 在 build 阶段固化以下变量（runtime 改不了，必须重建镜像才能更新）：

- `POSTHOG_API_KEY` → `EXPO_PUBLIC_POSTHOG_API_KEY`
- `REVENUE_CAT_STRIPE` → `EXPO_PUBLIC_REVENUE_CAT_STRIPE`

```bash
grep -E "POSTHOG_API_KEY|REVENUE_CAT_STRIPE" /Users/sangreal/Documents/dev-workspace/happy/.env 2>/dev/null | sed 's/=.*/=***/'
```

如果 `.env` 缺失或为空，build 会进行但前端缺少这些 key — PostHog 不发数据、Stripe 支付链路断开。

### 1.7 确认源码改动已落盘

webapp 容器跑的是 `expo export` 生成的 **静态文件 + nginx**，容器内不监听源码变化。
确保所有期望生效的改动都在 `packages/happy-app/` 和 `packages/happy-wire/` 目录里、且不在 .gitignore 中（COPY 不会复制被 ignore 的文件）。

```bash
# 列出 happy-app 源码改动
git -C /Users/sangreal/Documents/dev-workspace/happy status -s packages/happy-app packages/happy-wire
```

## 部署流程

### 2. 重建 Webapp 镜像

**始终使用 `--no-cache` 完全重建**：
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml build --no-cache webapp
```

> 为什么不用 `--no-cache-filter builder`？buildx 在多阶段构建中可能缓存 COPY 指令的源文件快照，导致源码变更不生效。expo export 单次约 60-90 秒，但全量重建确保产物里包含最新代码。

> 这一步内部依次执行：
> 1. `yarn install --frozen-lockfile`（deps 阶段）
> 2. `yarn workspace @kmmao/happy-wire build`（builder 阶段，先把 wire 编译给 app 用）
> 3. `yarn workspace happy-app expo export --platform web --output-dir dist`（生成静态产物）
> 4. nginx runner 阶段：把 dist 拷进 `/usr/share/nginx/html`

### 3. 重启 Webapp 容器
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml up -d webapp
```
- 只重启 webapp 容器，server / postgres / redis / caddy 保持不动
- Caddy 通过宿主 `host.docker.internal:8081` 反代到 webapp，webapp 重启后 Caddy 不需要重启

### 4. 验证产物已刷新（关键步骤）

webapp 没有数据库迁移，但要确认 nginx 正在提供 **新构建** 的静态文件。Expo 给每个静态资源加了内容哈希,可以用哈希变化来确认产物更新。

**记录旧版本资源哈希**（重建前执行）：
```bash
curl -s http://localhost:8081/ | grep -oE "_expo/static/js/web/index-[a-f0-9]+\.js" | head -1
```

**重建后核对新哈希**（应当与上面不同）：
```bash
curl -s http://localhost:8081/ | grep -oE "_expo/static/js/web/index-[a-f0-9]+\.js" | head -1
```

如果哈希 **没变** → 多半是 build args 走了缓存或源码改动没进 COPY 范围，回到步骤 1.7 / 2 重新排查。

### 5. 端到端验证
```bash
sleep 3
# 容器在跑 & nginx 起来
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml ps webapp
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml logs --tail 20 webapp 2>&1 | grep -iE "error|fail" || echo "no errors"

# 直连容器（HTTP，绕 Caddy）
curl -sI http://localhost:8081/ | head -3

# 走 Caddy 反代（HTTPS，外网入口）
curl -sIk https://w.sangreal.code.xycloud.info:2443/ | head -3
```

正常应当：
- `docker compose ps` 显示 `Up`
- 日志无 `error` / `failed`
- 直连 8081 返回 `HTTP/1.1 200 OK`
- Caddy 端返回 `HTTP/2 200`

### 6. 浏览器侧刷新

容器静态文件已更新，但用户浏览器还会用旧的 service worker / 内存缓存。给自己（或测试用户）发：

> 强制刷新一次：macOS `⌘+Shift+R` / Windows `Ctrl+F5`
> 如果还是旧 UI，DevTools → Application → Service Workers → Unregister，然后再强制刷新

## 注意事项
- Docker Compose 文件路径：`/Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml`
- Webapp 容器名：`happy-webapp`，宿主端口 `8081`
- Caddy 通过 `host.docker.internal:8081` 反代到 webapp（参见 docker-compose.yml 中 webapp 注释）
- **始终用 `--no-cache`**，不要用 `--no-cache-filter`（buildx 缓存不可靠）
- 这个 skill 不动 server / postgres / redis / minio / caddy / anthropic-proxy 容器
- 如果同时改了 `@kmmao/happy-wire`，并且 server 也消费它，记得同时跑 `deploy-server` skill
- webapp 镜像构建里走的是 **本地 monorepo 源码**（COPY packages/...），而不是 npm 上的 `@kmmao/happy-app` — 所以本地 commit 直接进镜像，不需要先发 npm
- 但 **wire 依赖** 例外：app 通过 npm dep `@kmmao/happy-wire` 引用,Docker 里 `yarn install` 会从 npm 拉 → 步骤 1.5 的版本对齐很关键
