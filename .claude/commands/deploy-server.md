重建并重启本地 Docker Server

## 前提检查

### 1. 确认 Docker 环境可用
```bash
docker compose version
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml ps
```

## 部署流程

### 2. 重建 Server 镜像

**始终使用 `--no-cache` 完全重建**：
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml build --no-cache server
```

> 为什么不用 `--no-cache-filter builder`？buildx 在多阶段构建中可能缓存 COPY 指令的源文件快照，导致源码变更不生效。`--no-cache` 虽然多花 30 秒但确保正确。

### 3. 重启 Server 容器
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml up -d server
```
- 只重启 server 容器，数据库/Redis/MinIO 保持不动

### 4. 如有 Prisma 变更，确认迁移是否已自动执行
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml logs --tail 30 server
```
- 当前 server 启动流程会自动执行 Prisma 迁移；日志中如果出现 `Applying migration` / `All migrations have been successfully applied.`，说明这一步已经完成。
- **不要直接运行** `docker compose ... exec server npx prisma migrate deploy`，容器默认工作目录下没有固定的 `prisma/schema.prisma`，这条命令会误报失败。
- 只有在日志里确认自动迁移没跑、且你明确需要手工补跑时，再先定位 schema：
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml exec server sh -lc 'find /repo -path "*/schema.prisma" | head -n 5'
```
- 找到实际 schema 路径后，再显式传 `--schema` 执行。

### 5. 验证
```bash
sleep 3
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml logs --tail 30 server
curl -s http://localhost:3005/
```
- 日志中应看到正常的请求处理（statusCode: 200）
- curl 应返回 "Welcome to Happy Server!"

## 注意事项
- Docker Compose 文件路径：`/Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml`
- Server 端口：3005
- **始终用 `--no-cache`**，不要用 `--no-cache-filter`（buildx 缓存不可靠）
- 如果构建失败，检查 `Dockerfile.server` 是否包含所有必要的 COPY 步骤
- 如果日志里已经显示 Prisma migration 成功，就不要再额外手工跑一次 migrate
- 如果确实需要手工迁移，先在容器内定位实际 schema 路径，再用 `--schema` 显式执行
