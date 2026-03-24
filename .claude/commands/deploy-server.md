重建并重启本地 Docker Server

## 前提检查

### 1. 确认 Docker 环境可用
```bash
docker compose version
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml ps
```

### 2. 检查变更范围（决定构建策略）
```bash
# 检查依赖文件是否有变更（只检查 server 构建实际用到的包）
git diff HEAD~1 --name-only -- package.json yarn.lock packages/happy-server/package.json packages/happy-wire/package.json packages/happy-server/prisma/schema.prisma patches/
```

根据输出判断构建策略：
- **依赖文件有变更**（package.json、yarn.lock、prisma/schema.prisma、patches/）→ 完全无缓存重建（`--no-cache`）
- **仅源码变更**（.ts 文件等）→ 无缓存重建源码层，但保留依赖缓存（`--no-cache-filter builder`）

> 原因：Dockerfile 的 deps stage 包含 yarn install，耗时最长。依赖没变时保留这层缓存可以从 2 分钟缩到 30 秒。但源码层（builder stage）必须始终重建，否则会用到旧的 .ts 编译结果。

## 部署流程

### 3. 重建 Server 镜像

**如果依赖有变更**（完全无缓存）：
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml build --no-cache server
```

**如果仅源码变更**（只跳过 builder 缓存，保留 deps 缓存）：
```bash
docker buildx build --no-cache-filter builder -f /Users/sangreal/Documents/dev-workspace/happy/Dockerfile.server -t happy-server /Users/sangreal/Documents/dev-workspace/happy
```

> 注意：这里用 `docker buildx build` 而非 `docker compose build`，因为 `docker compose build` 不支持 `--no-cache-filter` 参数。构建完成后镜像名为 `happy-server`，`docker compose up` 会自动使用它。

### 4. 重启 Server 容器
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml up -d server
```
- 只重启 server 容器，数据库/Redis/MinIO 保持不动

### 5. 如有 Prisma 变更，执行迁移
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml exec server npx prisma migrate deploy
```

### 6. 验证
```bash
sleep 3
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml logs --tail 15 server
curl -s http://localhost:3005/
```
- 日志中应看到正常的请求处理（statusCode: 200）
- curl 应返回 "Welcome to Happy Server!"

## 注意事项
- Docker Compose 文件路径：`/Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml`
- Server 端口：3005
- 构建策略：依赖变更 → `docker compose build --no-cache`；仅源码变更 → `docker buildx build --no-cache-filter builder`（compose 不支持该参数）
- 如果构建失败，检查 `Dockerfile.server` 是否包含所有必要的 COPY 步骤
- 如果启动失败，用 `docker compose logs server` 查看完整日志
