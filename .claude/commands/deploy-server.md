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

### 4. 如有 Prisma 变更，执行迁移
```bash
docker compose -f /Users/sangreal/Documents/dev-workspace/happy/docker-compose.yml exec server npx prisma migrate deploy
```

### 5. 验证
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
- **始终用 `--no-cache`**，不要用 `--no-cache-filter`（buildx 缓存不可靠）
- 如果构建失败，检查 `Dockerfile.server` 是否包含所有必要的 COPY 步骤
- 如果启动失败，用 `docker compose logs server` 查看完整日志
